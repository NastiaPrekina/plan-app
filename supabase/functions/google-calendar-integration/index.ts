import { createClient } from 'npm:@supabase/supabase-js@2'

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type StatePayload = {
  user_id: string
  return_to: string
  nonce: string
  exp: number
}

type RequestBody = {
  action?:
    | 'start_oauth'
    | 'connection_status'
    | 'disconnect'
    | 'sync_group_calendar'
    | 'set_sync_enabled'
    | 'process_sync_jobs'
  group_id?: string
  return_to?: string
  sync_enabled?: boolean
}

type SyncJobRow = {
  id: string
  group_id: string
  attempts: number
}

type PlanRow = {
  id: string
  event_catalog_id: string | null
  place_catalog_id: string | null
  title: string
  address: string | null
  link: string | null
}

type PlanEventRow = {
  id: string
  plan_id: string
  planned_at: string
  comment: string | null
}

type EventLinkRow = {
  id: string
  plan_event_id: string
  google_calendar_id: string
  google_event_id: string
}

class PublicError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing server secret: ${name}`)
  return value
}

function secretsMatch(actual: string, expected: string) {
  const actualBytes = new TextEncoder().encode(actual)
  const expectedBytes = new TextEncoder().encode(expected)
  if (actualBytes.length !== expectedBytes.length) return false
  let difference = 0
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index]
  }
  return difference === 0
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function base64UrlEncode(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  return base64ToBytes(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
}

async function stateKey() {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requiredSecret('GOOGLE_CALENDAR_STATE_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function createState(userId: string, returnTo: string) {
  const returnUrl = new URL(returnTo)
  if (!['https:', 'http:'].includes(returnUrl.protocol)) {
    throw new PublicError('Некорректный адрес возврата в приложение.')
  }

  const payload: StatePayload = {
    user_id: userId,
    return_to: returnUrl.toString(),
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  }
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await stateKey(),
    new TextEncoder().encode(encoded),
  )
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`
}

async function verifyState(state: string) {
  const [encoded, encodedSignature, ...rest] = state.split('.')
  if (!encoded || !encodedSignature || rest.length > 0) {
    throw new PublicError('OAuth state недействителен.', 401)
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await stateKey(),
    base64UrlDecode(encodedSignature),
    new TextEncoder().encode(encoded),
  )
  if (!valid) throw new PublicError('OAuth state недействителен.', 401)

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(encoded)),
  ) as StatePayload
  if (!payload.user_id || !payload.return_to || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new PublicError('Время подключения Google Calendar истекло.', 401)
  }
  return payload
}

async function encryptionKey() {
  const bytes = base64ToBytes(requiredSecret('GOOGLE_TOKEN_ENCRYPTION_KEY'))
  if (bytes.length !== 32) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptRefreshToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  )
  return {
    encrypted_refresh_token: bytesToBase64(new Uint8Array(encrypted)),
    encryption_iv: bytesToBase64(iv),
    encryption_algorithm: 'AES-GCM-256-v1',
  }
}

async function decryptRefreshToken(ciphertext: string, encodedIv: string) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encodedIv) },
    await encryptionKey(),
    base64ToBytes(ciphertext),
  )
  return new TextDecoder().decode(decrypted)
}

async function exchangeAuthorizationCode(code: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requiredSecret('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: requiredSecret('GOOGLE_CALENDAR_CLIENT_SECRET'),
      redirect_uri: requiredSecret('GOOGLE_CALENDAR_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  })
  const result = await response.json() as { refresh_token?: string; error_description?: string }
  if (!response.ok) throw new PublicError('Google не подтвердил подключение календаря.')
  return result.refresh_token ?? null
}

async function getStoredRefreshToken(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data: credential, error } = await admin
    .from('google_calendar_credentials')
    .select('encrypted_refresh_token, encryption_iv')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !credential) throw new PublicError('Google Calendar не подключён.', 409)

  return decryptRefreshToken(
    credential.encrypted_refresh_token,
    credential.encryption_iv,
  )
}

async function getAccessToken(admin: ReturnType<typeof createClient>, userId: string) {
  const refreshToken = await getStoredRefreshToken(admin, userId)
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requiredSecret('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: requiredSecret('GOOGLE_CALENDAR_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  })
  const result = await response.json() as { access_token?: string; error?: string }
  if (!response.ok || !result.access_token) {
    if (result.error === 'invalid_grant') {
      await admin.from('google_calendar_connections')
        .update({ status: 'needs_reauth' })
        .eq('user_id', userId)
    }
    throw new PublicError('Подключение Google Calendar устарело. Подключите календарь заново.', 401)
  }
  return { accessToken: result.access_token, refreshToken }
}

async function googleRequest(
  accessToken: string,
  path: string,
  init: RequestInit,
  operation: 'find_event' | 'create_event' | 'update_event' | 'delete_event',
) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    let message = ''
    let errors: unknown = []
    let responseBody: unknown = null

    try {
      const payload = await response.clone().json() as {
        error?: string | {
          message?: string
          errors?: unknown
        }
        message?: string
        errors?: unknown
      }
      responseBody = payload
      if (typeof payload.error === 'string') {
        message = payload.error
      } else if (payload.error && typeof payload.error === 'object') {
        message = payload.error.message ?? ''
        errors = payload.error.errors ?? []
      } else {
        message = payload.message ?? ''
        errors = payload.errors ?? []
      }
    } catch {
      const text = await response.clone().text().catch(() => '')
      responseBody = text
      message = text || 'Google Calendar API returned an unreadable error response.'
    }

    console.error('Google Calendar API error', {
      operation,
      status: response.status,
      statusText: response.statusText,
      message,
      errors,
      responseBody,
    })
  }

  return response
}

function googleEventBody(event: PlanEventRow, plan: PlanRow, groupId: string) {
  const startsAt = new Date(event.planned_at)
  if (Number.isNaN(startsAt.getTime())) {
    throw new PublicError('У события Plans некорректная дата начала.', 422)
  }
  const technicalEnd = new Date(startsAt.getTime() + 60 * 60 * 1000)
  if (technicalEnd.getTime() <= startsAt.getTime()) {
    throw new PublicError('Дата окончания события должна быть позже даты начала.', 422)
  }
  const description = [
    event.comment?.trim(),
    plan.link?.trim(),
    'Синхронизировано из Plans',
  ].filter(Boolean).join('\n\n')

  const body = {
    summary: plan.title.trim(),
    description,
    start: { dateTime: startsAt.toISOString() },
    end: { dateTime: technicalEnd.toISOString() },
    extendedProperties: {
      private: {
        plans_app_plan_event_id: event.id,
        plans_app_group_id: groupId,
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 },
        { method: 'popup', minutes: 60 },
      ],
    },
  }

  const location = plan.address?.trim()
  return location ? { ...body, location } : body
}

function normalizeInstagramUrl(value: string | null | undefined) {
  const instagram = value?.trim()
  if (!instagram) return ''
  if (/^https?:\/\//i.test(instagram)) return instagram
  return `https://www.instagram.com/${instagram.replace(/^@/, '')}`
}

async function requireGroupMembership(
  admin: ReturnType<typeof createClient>,
  userId: string,
  groupId: string,
) {
  const { data, error } = await admin
    .from('group_members')
    .select('group_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) throw new PublicError('У вас нет доступа к этой группе.', 403)
}

async function syncGroupCalendar(
  admin: ReturnType<typeof createClient>,
  userId: string,
  groupId: string,
  requireSyncEnabled = false,
) {
  await requireGroupMembership(admin, userId, groupId)
  const { data: connection, error: connectionError } = await admin
    .from('google_calendar_connections')
    .select('calendar_id, sync_enabled, status')
    .eq('user_id', userId)
    .maybeSingle()
  if (
    connectionError ||
    !connection ||
    connection.status !== 'connected' ||
    (requireSyncEnabled && !connection.sync_enabled)
  ) {
    throw new PublicError('Google Calendar не подключён.', 409)
  }

  const [{ data: planRows, error: plansError }, { data: links, error: linksError }] =
    await Promise.all([
      admin.from('plans')
        .select('id, event_catalog_id, place_catalog_id, title, address, link')
        .eq('group_id', groupId),
      admin.from('google_calendar_event_links').select('*')
        .eq('user_id', userId).eq('group_id', groupId),
    ])
  if (plansError || linksError) throw new PublicError('Не удалось подготовить синхронизацию.', 500)

  const plans = (planRows ?? []) as PlanRow[]
  const placeCatalogIds = [...new Set(
    plans
      .map((plan) => plan.place_catalog_id)
      .filter((placeId): placeId is string => Boolean(placeId))
  )]
  if (placeCatalogIds.length > 0) {
    const { data: placeRows, error: placeLinksError } = await admin
      .from('place_catalog')
      .select('id, website, instagram')
      .in('id', placeCatalogIds)
    if (placeLinksError) {
      throw new PublicError('Не удалось загрузить ссылки заведений.', 500)
    }

    const venueLinks = new Map<string, string>()
    for (const place of placeRows ?? []) {
      venueLinks.set(
        String(place.id),
        place.website?.trim() || normalizeInstagramUrl(place.instagram)
      )
    }
    for (const plan of plans) {
      if (plan.place_catalog_id) {
        plan.link = venueLinks.get(plan.place_catalog_id) ?? ''
      }
    }
  }
  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  const planIds = plans.map((plan) => plan.id)
  let events: PlanEventRow[] = []
  if (planIds.length > 0) {
    const { data, error } = await admin.from('plan_events')
      .select('id, plan_id, planned_at, comment').in('plan_id', planIds)
    if (error) throw new PublicError('Не удалось загрузить события группы.', 500)
    events = (data ?? []) as PlanEventRow[]
  }

  const { accessToken } = await getAccessToken(admin, userId)
  const calendarId = String(connection.calendar_id || 'primary')
  const encodedCalendarId = encodeURIComponent(calendarId)
  const linkByPlanEvent = new Map(
    ((links ?? []) as EventLinkRow[]).map((link) => [link.plan_event_id, link]),
  )
  let created = 0
  let updated = 0
  let deleted = 0

  for (const event of events) {
    const plan = planById.get(event.plan_id)
    if (!plan) continue
    const existing = linkByPlanEvent.get(event.id)
    const body = JSON.stringify(googleEventBody(event, plan, groupId))
    let response: Response

    if (existing) {
      response = await googleRequest(
        accessToken,
        `/calendars/${encodedCalendarId}/events/${encodeURIComponent(existing.google_event_id)}`,
        { method: 'PATCH', body },
        'update_event',
      )
      if (response.status !== 404 && response.status !== 410) {
        if (!response.ok) throw new PublicError('Google Calendar не смог обновить событие.', 502)
        await admin.from('google_calendar_event_links')
          .update({ last_synced_at: new Date().toISOString() }).eq('id', existing.id)
        updated += 1
        continue
      }
    }

    const lookup = new URLSearchParams({
      maxResults: '1',
      showDeleted: 'false',
      privateExtendedProperty: `plans_app_plan_event_id=${event.id}`,
    })
    const lookupResponse = await googleRequest(
      accessToken,
      `/calendars/${encodedCalendarId}/events?${lookup.toString()}`,
      { method: 'GET' },
      'find_event',
    )
    if (!lookupResponse.ok) {
      throw new PublicError('Google Calendar не смог проверить существующее событие.', 502)
    }
    const lookupResult = await lookupResponse.json() as { items?: Array<{ id?: string }> }
    const recoveredGoogleEventId = lookupResult.items?.[0]?.id
    if (recoveredGoogleEventId) {
      const recoveryResponse = await googleRequest(
        accessToken,
        `/calendars/${encodedCalendarId}/events/${encodeURIComponent(recoveredGoogleEventId)}`,
        { method: 'PATCH', body },
        'update_event',
      )
      if (!recoveryResponse.ok) {
        throw new PublicError('Google Calendar не смог восстановить связь с событием.', 502)
      }
      const { error: recoveryError } = await admin
        .from('google_calendar_event_links')
        .upsert({
          user_id: userId,
          group_id: groupId,
          plan_event_id: event.id,
          google_calendar_id: calendarId,
          google_event_id: recoveredGoogleEventId,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id,plan_event_id' })
      if (recoveryError) {
        throw new PublicError('Не удалось восстановить связь с Google Calendar.', 500)
      }
      updated += 1
      continue
    }

    const createEventBody = googleEventBody(event, plan, groupId)
    console.log('Google create event payload', {
      summary: createEventBody.summary,
      start: createEventBody.start,
      end: createEventBody.end,
      ...('location' in createEventBody
        ? { location: createEventBody.location }
        : {}),
      hasDescription: Boolean(createEventBody.description),
      extendedProperties: createEventBody.extendedProperties,
      reminders: createEventBody.reminders,
    })
    response = await googleRequest(
      accessToken,
      `/calendars/${encodedCalendarId}/events`,
      {
        method: 'POST',
        body: JSON.stringify(createEventBody),
      },
      'create_event',
    )
    const googleEvent = await response.json() as { id?: string }
    if (!response.ok || !googleEvent.id) {
      throw new PublicError('Google Calendar не смог создать событие.', 502)
    }
    const { error: upsertError } = await admin.from('google_calendar_event_links').upsert({
      user_id: userId,
      group_id: groupId,
      plan_event_id: event.id,
      google_calendar_id: calendarId,
      google_event_id: googleEvent.id,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,plan_event_id' })
    if (upsertError) throw new PublicError('Не удалось сохранить связь с Google Calendar.', 500)
    created += 1
  }

  const sourceIds = new Set(events.map((event) => event.id))
  for (const stale of (links ?? []) as EventLinkRow[]) {
    if (sourceIds.has(stale.plan_event_id)) continue
    const response = await googleRequest(
      accessToken,
      `/calendars/${encodeURIComponent(stale.google_calendar_id)}/events/${encodeURIComponent(stale.google_event_id)}`,
      { method: 'DELETE' },
      'delete_event',
    )
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new PublicError('Google Calendar не смог удалить отменённое событие.', 502)
    }
    await admin.from('google_calendar_event_links').delete().eq('id', stale.id)
    deleted += 1
  }

  const syncedAt = new Date().toISOString()
  const { error: updateError } = await admin.from('google_calendar_connections')
    .update({ last_sync_at: syncedAt }).eq('user_id', userId)
  if (updateError) throw new PublicError('События синхронизированы, но статус не обновился.', 500)
  return { created, updated, deleted, synced_at: syncedAt }
}

function safeJobError(error: unknown) {
  const message = error instanceof PublicError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Неизвестная ошибка синхронизации.'
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

async function processSyncJobs(admin: ReturnType<typeof createClient>) {
  const { data: claimedJobs, error: claimError } = await admin.rpc(
    'claim_google_calendar_sync_jobs',
    { requested_limit: 10 },
  )
  if (claimError) throw new PublicError('Не удалось получить задания синхронизации.', 500)

  let completed = 0
  let retried = 0
  let failed = 0

  for (const job of (claimedJobs ?? []) as SyncJobRow[]) {
    const { data: members, error: membersError } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', job.group_id)

    const failures: string[] = []
    if (membersError) {
      failures.push('Не удалось загрузить участников группы.')
    } else {
      const userIds = (members ?? []).map((member) => String(member.user_id))
      let connectedUserIds: string[] = []
      if (userIds.length > 0) {
        const { data: connections, error: connectionsError } = await admin
          .from('google_calendar_connections')
          .select('user_id')
          .in('user_id', userIds)
          .eq('sync_enabled', true)
          .eq('status', 'connected')
        if (connectionsError) {
          failures.push('Не удалось загрузить подключения группы.')
        } else {
          connectedUserIds = (connections ?? []).map((row) => String(row.user_id))
        }
      }

      for (const userId of connectedUserIds) {
        try {
          await syncGroupCalendar(admin, userId, job.group_id, true)
        } catch (error) {
          failures.push(safeJobError(error))
        }
      }
    }

    if (failures.length === 0) {
      await admin.from('google_calendar_sync_jobs').update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', job.id)
      completed += 1
      continue
    }

    const lastError = [...new Set(failures)].join(' | ').slice(0, 500)
    const nextStatus = job.attempts >= 5 ? 'failed' : 'pending'
    const { error: retryError } = await admin.from('google_calendar_sync_jobs').update({
      status: nextStatus,
      last_error: lastError,
      processed_at: nextStatus === 'failed' ? new Date().toISOString() : null,
    }).eq('id', job.id)

    if (retryError && nextStatus === 'pending') {
      // A newer pending job already covers this group, so this older job can finish.
      await admin.from('google_calendar_sync_jobs').update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        last_error: lastError,
      }).eq('id', job.id)
    }
    if (nextStatus === 'failed') failed += 1
    else retried += 1
  }

  return {
    claimed: (claimedJobs ?? []).length,
    completed,
    retried,
    failed,
  }
}

async function oauthCallback(requestUrl: URL, admin: ReturnType<typeof createClient>) {
  const stateValue = requestUrl.searchParams.get('state') ?? ''
  const payload = await verifyState(stateValue)
  const returnUrl = new URL(payload.return_to)
  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    returnUrl.searchParams.set('google_calendar', 'cancelled')
    return Response.redirect(returnUrl.toString(), 302)
  }
  const code = requestUrl.searchParams.get('code')
  if (!code) throw new PublicError('Google не вернул код авторизации.')

  const refreshToken = await exchangeAuthorizationCode(code)
  if (refreshToken) {
    const encrypted = await encryptRefreshToken(refreshToken)
    const { error } = await admin.from('google_calendar_credentials').upsert({
      user_id: payload.user_id,
      ...encrypted,
    })
    if (error) throw new PublicError('Не удалось безопасно сохранить подключение.', 500)
  } else {
    const { data } = await admin.from('google_calendar_credentials')
      .select('user_id').eq('user_id', payload.user_id).maybeSingle()
    if (!data) throw new PublicError('Google не выдал refresh token. Повторите подключение.', 409)
  }

  const { error: connectionError } = await admin.from('google_calendar_connections').upsert({
    user_id: payload.user_id,
    calendar_id: 'primary',
    connected_at: new Date().toISOString(),
    sync_enabled: true,
    status: 'connected',
  })
  if (connectionError) throw new PublicError('Не удалось сохранить подключение.', 500)

  returnUrl.searchParams.set('google_calendar', 'connected')
  return Response.redirect(returnUrl.toString(), 302)
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(
    requiredSecret('SUPABASE_URL'),
    requiredSecret('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  try {
    const requestUrl = new URL(request.url)
    if (request.method === 'GET') {
      try {
        return await oauthCallback(requestUrl, admin)
      } catch (callbackError) {
        try {
          const payload = await verifyState(requestUrl.searchParams.get('state') ?? '')
          const returnUrl = new URL(payload.return_to)
          returnUrl.searchParams.set('google_calendar', 'error')
          return Response.redirect(returnUrl.toString(), 302)
        } catch {
          throw callbackError
        }
      }
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

    const body = await request.json() as RequestBody
    if (body.action === 'process_sync_jobs') {
      const workerSecret = request.headers.get('x-google-calendar-worker-secret') ?? ''
      if (!secretsMatch(workerSecret, requiredSecret('GOOGLE_CALENDAR_WORKER_SECRET'))) {
        throw new PublicError('Недействительный worker credential.', 401)
      }
      return jsonResponse({ result: await processSyncJobs(admin) })
    }

    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) {
      throw new PublicError('Требуется авторизация.', 401)
    }
    const { data, error } = await admin.auth.getUser(authorization.slice('Bearer '.length))
    if (error || !data.user) throw new PublicError('Сессия недействительна.', 401)

    if (body.action === 'start_oauth') {
      const returnTo = body.return_to?.trim()
      if (!returnTo) throw new PublicError('Не задан адрес возврата в приложение.')
      const state = await createState(data.user.id, returnTo)
      const authorizationUrl = new URL(GOOGLE_AUTH_URL)
      authorizationUrl.search = new URLSearchParams({
        client_id: requiredSecret('GOOGLE_CALENDAR_CLIENT_ID'),
        redirect_uri: requiredSecret('GOOGLE_CALENDAR_REDIRECT_URI'),
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString()
      return jsonResponse({ authorization_url: authorizationUrl.toString() })
    }

    if (body.action === 'connection_status') {
      const { data: connection, error: statusError } = await admin
        .from('google_calendar_connections')
        .select('calendar_id, connected_at, last_sync_at, sync_enabled, status')
        .eq('user_id', data.user.id).maybeSingle()
      if (statusError) throw new PublicError('Не удалось проверить подключение.', 500)
      return jsonResponse({ connected: Boolean(connection), connection })
    }

    if (body.action === 'sync_group_calendar') {
      if (!body.group_id) throw new PublicError('Не выбрана группа.')
      return jsonResponse({
        result: await syncGroupCalendar(admin, data.user.id, body.group_id),
      })
    }

    if (body.action === 'set_sync_enabled') {
      if (typeof body.sync_enabled !== 'boolean') {
        throw new PublicError('Не задано состояние автоматической синхронизации.')
      }
      const { data: connection, error: updateError } = await admin
        .from('google_calendar_connections')
        .update({ sync_enabled: body.sync_enabled })
        .eq('user_id', data.user.id)
        .select('calendar_id, connected_at, last_sync_at, sync_enabled, status')
        .single()
      if (updateError) throw new PublicError('Не удалось изменить настройку синхронизации.', 500)
      return jsonResponse({ connection })
    }

    if (body.action === 'disconnect') {
      const refreshToken = await getStoredRefreshToken(admin, data.user.id)
      await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      }).catch(() => undefined)
      await admin.from('google_calendar_credentials').delete().eq('user_id', data.user.id)
      await admin.from('google_calendar_connections').delete().eq('user_id', data.user.id)
      return jsonResponse({ disconnected: true })
    }

    throw new PublicError('Неизвестное действие.')
  } catch (error) {
    const publicError = error instanceof PublicError ? error : null
    console.error('Google Calendar integration failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return jsonResponse(
      { error: publicError?.message ?? 'Не удалось выполнить операцию с Google Calendar.' },
      publicError?.status ?? 500,
    )
  }
})

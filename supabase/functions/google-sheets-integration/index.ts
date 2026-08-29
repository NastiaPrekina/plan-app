import { createClient } from 'npm:@supabase/supabase-js@2'
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6'

const EXPECTED_HEADERS = [
  'Вариант',
  'Тип развлечения',
  'Цена',
  'Адрес',
  'Фишка / примечание',
  'Ссылка',
  'Ключевые слова',
  'Дата',
  'День',
  'Коммент',
  'Идем',
]

const TECHNICAL_HEADER = '_plan_id'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ServiceAccountCredentials = {
  client_email: string
  private_key: string
  private_key_id?: string
  token_uri?: string
}

type RequestBody = {
  action?: 'service_account_info' | 'validate'
  group_id?: string
  spreadsheet_url?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function getSupabasePublishableKey() {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY')
  const localKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')

  if (legacyKey || localKey) {
    return legacyKey ?? localKey ?? ''
  }

  const keysJson = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')

  if (!keysJson) {
    throw new Error('Supabase publishable key is not configured.')
  }

  const keys = JSON.parse(keysJson) as Record<string, string>
  const key = keys.default ?? Object.values(keys)[0]

  if (!key) {
    throw new Error('Supabase publishable key is not configured.')
  }

  return key
}

function getServiceAccountCredentials() {
  const encodedCredentials = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON_B64')

  if (!encodedCredentials) {
    throw new Error('Google service account credentials are not configured.')
  }

  let credentials: ServiceAccountCredentials

  try {
    credentials = JSON.parse(atob(encodedCredentials)) as ServiceAccountCredentials
  } catch {
    throw new Error('Google service account credentials are invalid.')
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google service account credentials are incomplete.')
  }

  return credentials
}

function extractSpreadsheetId(value: string) {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Введите корректную ссылку на Google Таблицу.')
  }

  if (url.hostname !== 'docs.google.com') {
    throw new Error('Ссылка должна вести на docs.google.com.')
  }

  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)

  if (!match?.[1]) {
    throw new Error('Не удалось определить ID Google Таблицы из ссылки.')
  }

  return match[1]
}

async function getGoogleAccessToken(credentials: ServiceAccountCredentials) {
  const now = Math.floor(Date.now() / 1000)
  const privateKey = await importPKCS8(credentials.private_key, 'RS256')
  const assertion = await new SignJWT({ scope: GOOGLE_SHEETS_SCOPE })
    .setProtectedHeader({
      alg: 'RS256',
      typ: 'JWT',
      ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
    })
    .setIssuer(credentials.client_email)
    .setAudience(credentials.token_uri ?? GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const tokenResponse = await fetch(credentials.token_uri ?? GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const tokenData = await tokenResponse.json() as {
    access_token?: string
    error_description?: string
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error('Google token error:', tokenData.error_description ?? tokenResponse.status)
    throw new Error('Не удалось авторизовать service account в Google API.')
  }

  return tokenData.access_token
}

function quoteSheetName(name: string) {
  return `'${name.replaceAll("'", "''")}'`
}

async function fetchGoogleJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data = await response.json() as Record<string, unknown>

  if (!response.ok) {
    const googleError = data.error as { message?: string } | undefined
    console.error('Google Sheets API error:', response.status, googleError?.message)

    if (response.status === 403 || response.status === 404) {
      throw new Error(
        'Таблица недоступна. Дайте service account доступ Editor и попробуйте снова.'
      )
    }

    throw new Error('Google Sheets API временно недоступен. Попробуйте позже.')
  }

  return data
}

async function validateSpreadsheet(spreadsheetId: string, accessToken: string) {
  const metadataUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  )
  metadataUrl.searchParams.set(
    'fields',
    'properties.title,sheets.properties(sheetId,title,index,hidden,sheetType)'
  )

  const metadata = await fetchGoogleJson(metadataUrl.toString(), accessToken) as {
    properties?: { title?: string }
    sheets?: Array<{
      properties?: {
        sheetId?: number
        title?: string
        index?: number
        hidden?: boolean
        sheetType?: string
      }
    }>
  }

  const sheet = (metadata.sheets ?? [])
    .map((item) => item.properties)
    .filter(
      (properties): properties is NonNullable<typeof properties> =>
        Boolean(properties) &&
        properties.hidden !== true &&
        (properties.sheetType ?? 'GRID') === 'GRID' &&
        Boolean(properties.title)
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]

  if (!sheet?.title) {
    throw new Error('В таблице не найдена доступная вкладка.')
  }

  const range = `${quoteSheetName(sheet.title)}!1:1`
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  )
  valuesUrl.searchParams.set('majorDimension', 'ROWS')
  valuesUrl.searchParams.set('valueRenderOption', 'FORMATTED_VALUE')

  const valuesData = await fetchGoogleJson(valuesUrl.toString(), accessToken) as {
    values?: unknown[][]
  }
  const headers = (valuesData.values?.[0] ?? []).map((value) => String(value).trim())
  const missingHeaders = EXPECTED_HEADERS.filter((header) => !headers.includes(header))
  const technicalColumnMissing = !headers.includes(TECHNICAL_HEADER)
  const titleMissing = !headers.includes('Вариант')
  const warnings: string[] = []

  if (missingHeaders.length > 0 && !titleMissing) {
    warnings.push(`Не найдены столбцы: ${missingHeaders.join(', ')}.`)
  }

  if (technicalColumnMissing) {
    warnings.push('Технический столбец _plan_id отсутствует.')
  }

  return {
    spreadsheetTitle: metadata.properties?.title ?? spreadsheetId,
    sheetName: sheet.title,
    headers,
    validation: {
      status: titleMissing ? 'failed' : warnings.length > 0 ? 'warning' : 'passed',
      valid: !titleMissing,
      missingHeaders,
      warnings,
      technicalColumnMissing,
    },
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const authorization = request.headers.get('Authorization')

    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Требуется авторизация.' }, 401)
    }

    const accessToken = authorization.slice('Bearer '.length)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      getSupabasePublishableKey(),
      { global: { headers: { Authorization: authorization } } }
    )
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)

    if (userError || !userData.user) {
      return jsonResponse({ error: 'Сессия недействительна.' }, 401)
    }

    const body = await request.json() as RequestBody

    if (!body.group_id) {
      return jsonResponse({ error: 'Не указана группа.' }, 400)
    }

    const { data: membership, error: membershipError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', body.group_id)
      .eq('user_id', userData.user.id)
      .maybeSingle()

    if (membershipError) {
      console.error('Membership check error:', membershipError)
      return jsonResponse({ error: 'Не удалось проверить права доступа.' }, 500)
    }

    if (membership?.role !== 'owner') {
      return jsonResponse({ error: 'Подключать таблицу может только владелец группы.' }, 403)
    }

    const credentials = getServiceAccountCredentials()

    if (body.action === 'service_account_info') {
      return jsonResponse({ serviceAccountEmail: credentials.client_email })
    }

    if (body.action !== 'validate' || !body.spreadsheet_url) {
      return jsonResponse({ error: 'Не указана ссылка на Google Таблицу.' }, 400)
    }

    const spreadsheetId = extractSpreadsheetId(body.spreadsheet_url)
    const googleAccessToken = await getGoogleAccessToken(credentials)
    const result = await validateSpreadsheet(spreadsheetId, googleAccessToken)

    return jsonResponse({
      serviceAccountEmail: credentials.client_email,
      spreadsheetId,
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка.'
    console.error('Google Sheets integration error:', message)
    return jsonResponse({ error: message }, 400)
  }
})

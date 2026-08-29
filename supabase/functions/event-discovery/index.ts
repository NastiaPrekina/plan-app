import { createClient } from 'npm:@supabase/supabase-js@2'

const KUDAGO_EVENTS_URL = 'https://kudago.com/public-api/v1.4/events/'
const ALLOWED_LOCATIONS = new Set(['msk', 'spb'])
const EVENT_FIELDS = [
  'id',
  'title',
  'description',
  'dates',
  'place',
  'price',
  'is_free',
  'categories',
  'images',
  'site_url',
  'age_restriction',
].join(',')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type SearchRequest = {
  action?: 'search_events'
  location?: string
  actual_since?: number
  actual_until?: number
  page_size?: number
  categories?: string[]
  is_free?: boolean
}

type KudaGoDate = {
  start?: number | null
  end?: number | null
}

type KudaGoEvent = {
  id?: number | string
  title?: string
  description?: string
  dates?: KudaGoDate[]
  place?: { title?: string; address?: string } | null
  price?: string
  is_free?: boolean
  categories?: Array<string | { slug?: string; name?: string }>
  images?: Array<{ image?: string }>
  site_url?: string
  age_restriction?: string
}

class PublicError extends Error {}

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
  const direct =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')

  if (direct) return direct

  const rawKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  const keys = rawKeys
    ? JSON.parse(rawKeys) as Record<string, string>
    : {}
  const key = keys.default ?? Object.values(keys)[0]

  if (!key) {
    throw new PublicError('Не удалось проверить авторизацию приложения.')
  }

  return key
}

function validateSearch(body: SearchRequest) {
  if (body.action !== 'search_events') {
    return 'Неизвестное действие.'
  }

  if (!body.location || !ALLOWED_LOCATIONS.has(body.location)) {
    return 'Выберите доступный город.'
  }

  if (
    !Number.isInteger(body.actual_since) ||
    !Number.isInteger(body.actual_until) ||
    Number(body.actual_until) <= Number(body.actual_since)
  ) {
    return 'Указан некорректный период поиска.'
  }

  if (
    body.page_size !== undefined &&
    (!Number.isInteger(body.page_size) || body.page_size < 1 || body.page_size > 100)
  ) {
    return 'Количество мероприятий должно быть от 1 до 100.'
  }

  if (
    body.categories !== undefined &&
    (!Array.isArray(body.categories) ||
      body.categories.some(
        (category) =>
          typeof category !== 'string' ||
          !/^-?[a-z0-9-]+$/.test(category)
      ))
  ) {
    return 'Переданы некорректные категории.'
  }

  if (body.is_free !== undefined && typeof body.is_free !== 'boolean') {
    return 'Фильтр бесплатных мероприятий указан некорректно.'
  }

  return null
}

function toIsoDate(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

function secureUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.startsWith('http://') ? `https://${value.slice(7)}` : value
}

function normalizeEvent(event: KudaGoEvent, since: number, until: number) {
  const dates = (event.dates ?? [])
    .filter((date) => {
      const start = date.start ?? date.end
      const end = date.end ?? date.start
      return typeof start === 'number' && typeof end === 'number' && end >= since && start <= until
    })
    .sort((a, b) => (a.start ?? a.end ?? 0) - (b.start ?? b.end ?? 0))
  const selectedDate = dates[0] ?? event.dates?.[0]
  const categories = (event.categories ?? [])
    .map((category) =>
      typeof category === 'string'
        ? category
        : category.slug ?? category.name ?? ''
    )
    .filter(Boolean)

  return {
    source: 'kudago' as const,
    source_id: String(event.id ?? ''),
    title: String(event.title ?? '').trim(),
    description: String(event.description ?? '').trim(),
    starts_at: toIsoDate(selectedDate?.start),
    ends_at: toIsoDate(selectedDate?.end),
    place_name: String(event.place?.title ?? '').trim(),
    address: String(event.place?.address ?? '').trim(),
    price: String(event.price ?? '').trim(),
    is_free: event.is_free === true,
    image_url: secureUrl(event.images?.[0]?.image),
    source_url: secureUrl(event.site_url),
    categories,
    age_restriction: String(event.age_restriction ?? '').trim(),
  }
}

async function searchKudaGoEvents(body: SearchRequest) {
  const url = new URL(KUDAGO_EVENTS_URL)
  url.searchParams.set('lang', 'ru')
  url.searchParams.set('location', body.location ?? '')
  url.searchParams.set('actual_since', String(body.actual_since))
  url.searchParams.set('actual_until', String(body.actual_until))
  url.searchParams.set('page_size', String(body.page_size ?? 30))
  url.searchParams.set('fields', EVENT_FIELDS)
  url.searchParams.set('expand', 'dates,place,images')
  url.searchParams.set('text_format', 'text')

  if (body.categories?.length) {
    url.searchParams.set('categories', body.categories.join(','))
  }

  if (body.is_free !== undefined) {
    url.searchParams.set('is_free', body.is_free ? 'true' : 'false')
  }

  let response: Response

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new PublicError('KudaGo сейчас не отвечает. Попробуйте ещё раз позже.')
  }

  if (!response.ok) {
    console.error('KudaGo API request failed:', response.status)
    throw new PublicError(
      response.status === 400
        ? 'KudaGo отклонил параметры поиска.'
        : 'KudaGo сейчас недоступен. Попробуйте ещё раз позже.'
    )
  }

  const data = await response.json() as {
    count?: number
    results?: KudaGoEvent[]
  }
  const events = (data.results ?? [])
    .map((event) =>
      normalizeEvent(event, Number(body.actual_since), Number(body.actual_until))
    )
    .filter(
      (event) => event.source_id && event.title && event.source_url
    )

  return { source: 'kudago', total: data.count ?? events.length, events }
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      getSupabasePublishableKey(),
      { global: { headers: { Authorization: authorization } } }
    )
    const { data, error } = await supabase.auth.getUser(
      authorization.slice('Bearer '.length)
    )

    if (error || !data.user) {
      return jsonResponse({ error: 'Сессия недействительна.' }, 401)
    }

    const body = await request.json() as SearchRequest
    const validationError = validateSearch(body)

    if (validationError) {
      return jsonResponse({ error: validationError }, 400)
    }

    return jsonResponse(await searchKudaGoEvents(body))
  } catch (error) {
    const message = error instanceof PublicError
      ? error.message
      : 'Не удалось получить мероприятия.'
    console.error(
      'Event discovery failed:',
      error instanceof Error ? error.name : 'Unknown error'
    )
    return jsonResponse({ error: message }, 502)
  }
})

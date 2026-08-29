import { createClient } from 'npm:@supabase/supabase-js@2'

const FOURSQUARE_SEARCH_URL = 'https://places-api.foursquare.com/places/search'
const FOURSQUARE_API_VERSION = '2025-06-17'

type PlaceKind = 'restaurant' | 'cafe' | 'bar'

type SearchPlacesRequest = {
  action?: 'search_places'
  kind?: PlaceKind
  city?: string
  limit?: number
}

type CityConfig = {
  name: string
  latitude: number
  longitude: number
  radius: number
}

type FoursquareCategory = {
  fsq_category_id?: string
  id?: string
  name?: string
  short_name?: string
  plural_name?: string
}

type FoursquarePlace = {
  fsq_place_id?: string
  fsq_id?: string
  name?: string
  latitude?: number
  longitude?: number
  location?: {
    address?: string
    formatted_address?: string
    locality?: string
    region?: string
    postcode?: string
    country?: string
  }
  address?: string
  categories?: FoursquareCategory[]
  fsq_category_labels?: string[]
  tel?: string
  website?: string
  rating?: number
  popularity?: number
  price?: number
  hours?: unknown
  placemaker_url?: string
}

type NormalizedPlace = {
  catalog_id: string | null
  source: string
  source_place_id: string
  name: string
  kind: PlaceKind
  categories: string[]
  cuisine: string[]
  address: string | null
  lat: number | null
  lon: number | null
  website: string | null
  phone: string | null
  rating: number | null
  popularity: number | null
  price_level: number | null
  opening_hours: unknown | null
  source_url: string | null
}

const CITY_CONFIG: Record<string, CityConfig> = {
  msk: {
    name: 'Москва',
    latitude: 55.7558,
    longitude: 37.6173,
    radius: 25000,
  },
  spb: {
    name: 'Санкт-Петербург',
    latitude: 59.9343,
    longitude: 30.3351,
    radius: 20000,
  },
}

// Foursquare-specific taxonomy stays inside this adapter boundary.
const FOURSQUARE_CATEGORY_IDS: Record<PlaceKind, string> = {
  restaurant: '4d4b7105d754a06374d81259',
  cafe: '63be6904847c3692a84b9bb6',
  bar: '4bf58dd8d48988d116941735',
}

const GENERIC_FOOD_CATEGORIES = new Set([
  'restaurant',
  'restaurants',
  'dining and drinking',
  'cafe, coffee, and tea house',
  'café',
  'cafe',
  'coffee shop',
  'bar',
])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (!key) throw new PublicError('Не удалось проверить авторизацию.', 500)
  return key
}

function getRequiredSecret(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new PublicError('Сервис поиска мест не настроен.', 500)
  return value
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeAddress(place: FoursquarePlace) {
  if (place.location?.formatted_address) {
    return place.location.formatted_address.trim()
  }

  const parts = [
    place.location?.address ?? place.address,
    place.location?.locality,
    place.location?.region,
    place.location?.postcode,
  ].filter((part): part is string => Boolean(part?.trim()))

  return parts.length > 0 ? [...new Set(parts)].join(', ') : null
}

function categoryNames(place: FoursquarePlace) {
  const categories = (place.categories ?? [])
    .map((category) => category.name ?? category.short_name ?? '')
    .filter(Boolean)
  return [...new Set([...categories, ...(place.fsq_category_labels ?? [])])]
}

function cuisineNames(categories: string[], kind: PlaceKind) {
  if (kind !== 'restaurant') return []

  return categories.filter((category) => {
    const normalized = category.toLocaleLowerCase('en-US')
    return !GENERIC_FOOD_CATEGORIES.has(normalized) &&
      (normalized.includes('restaurant') || normalized.includes('food'))
  })
}

function normalizeFoursquarePlace(
  place: FoursquarePlace,
  kind: PlaceKind
): NormalizedPlace | null {
  const sourcePlaceId = optionalString(place.fsq_place_id ?? place.fsq_id)
  const name = optionalString(place.name)
  if (!sourcePlaceId || !name) return null

  const categories = categoryNames(place)
  const price = optionalNumber(place.price)

  return {
    catalog_id: null,
    source: 'foursquare',
    source_place_id: sourcePlaceId,
    name,
    kind,
    categories,
    cuisine: cuisineNames(categories, kind),
    address: normalizeAddress(place),
    lat: optionalNumber(place.latitude),
    lon: optionalNumber(place.longitude),
    website: optionalString(place.website),
    phone: optionalString(place.tel),
    rating: optionalNumber(place.rating),
    popularity: optionalNumber(place.popularity),
    price_level: price && Number.isInteger(price) && price >= 1 && price <= 4
      ? price
      : null,
    opening_hours: place.hours ?? null,
    source_url: optionalString(place.placemaker_url),
  }
}

// Provider adapter: all Foursquare endpoint, auth, taxonomy and payload details
// are isolated here and in normalizeFoursquarePlace.
async function searchWithFoursquare(
  kind: PlaceKind,
  city: CityConfig,
  limit: number
) {
  const url = new URL(FOURSQUARE_SEARCH_URL)
  url.searchParams.set('ll', `${city.latitude},${city.longitude}`)
  url.searchParams.set('radius', String(city.radius))
  url.searchParams.set('fsq_category_ids', FOURSQUARE_CATEGORY_IDS[kind])
  url.searchParams.set('sort', 'RELEVANCE')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('tel_format', 'NATIONAL')

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${getRequiredSecret('FOURSQUARE_API_KEY')}`,
        'X-Places-Api-Version': FOURSQUARE_API_VERSION,
      },
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new PublicError('Foursquare сейчас не отвечает. Попробуйте позже.', 502)
  }

  const payload = await response.json().catch(() => null) as {
    results?: FoursquarePlace[]
    message?: string
  } | null

  if (!response.ok) {
    console.error('Foursquare search failed:', response.status)
    throw new PublicError(
      response.status === 401 || response.status === 403
        ? 'Сервис поиска мест временно недоступен.'
        : 'Foursquare не смог выполнить поиск. Попробуйте позже.',
      response.status >= 500 ? 502 : 400
    )
  }

  return (payload?.results ?? [])
    .map((place) => ({
      normalized: normalizeFoursquarePlace(place, kind),
      payload: place,
    }))
    .filter(
      (item): item is { normalized: NormalizedPlace; payload: FoursquarePlace } =>
        item.normalized !== null
    )
}

async function searchPlaces(
  body: SearchPlacesRequest,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
) {
  if (body.action !== 'search_places') {
    throw new PublicError('Неизвестное действие.')
  }
  if (!body.kind || !['restaurant', 'cafe', 'bar'].includes(body.kind)) {
    throw new PublicError('Выберите тип места.')
  }
  if (
    body.limit !== undefined &&
    (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)
  ) {
    throw new PublicError('Количество мест должно быть от 1 до 20.')
  }

  let citySlug = body.city
  if (!citySlug) {
    const { data, error } = await userClient
      .from('user_preferences')
      .select('city')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error('Place city preference failed:', error.code)
      throw new PublicError('Не удалось определить город.', 500)
    }
    citySlug = data?.city ?? undefined
  }

  const city = citySlug ? CITY_CONFIG[citySlug] : undefined
  if (!city || !citySlug) {
    throw new PublicError('Выберите город для поиска мест.')
  }

  const providerResults = await searchWithFoursquare(
    body.kind,
    city,
    body.limit ?? 20
  )
  const seenAt = new Date().toISOString()
  const rows = providerResults.map(({ normalized, payload }) => ({
    source: normalized.source,
    source_place_id: normalized.source_place_id,
    name: normalized.name,
    kind: normalized.kind,
    categories: normalized.categories,
    cuisine: normalized.cuisine,
    address: normalized.address,
    lat: normalized.lat,
    lon: normalized.lon,
    website: normalized.website,
    phone: normalized.phone,
    rating: normalized.rating,
    popularity: normalized.popularity,
    price_level: normalized.price_level,
    opening_hours: normalized.opening_hours,
    city: citySlug,
    source_url: normalized.source_url,
    source_payload: payload,
    last_seen_at: seenAt,
  }))

  if (rows.length === 0) {
    return { city: citySlug, city_name: city.name, places: [] }
  }

  const { data: catalogRows, error: catalogError } = await admin
    .from('place_catalog')
    .upsert(rows, { onConflict: 'source,source_place_id' })
    .select('id, source, source_place_id')

  if (catalogError) {
    console.error('Place catalog upsert failed:', catalogError.code)
    throw new PublicError('Не удалось сохранить найденные места.', 500)
  }

  const catalogIds = new Map(
    (catalogRows ?? []).map((row) => [
      `${String(row.source)}:${String(row.source_place_id)}`,
      String(row.id),
    ])
  )
  const places = providerResults.map(({ normalized }) => ({
    ...normalized,
    catalog_id: catalogIds.get(
      `${normalized.source}:${normalized.source_place_id}`
    ) ?? null,
  }))

  return { city: citySlug, city_name: city.name, places }
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const userClient = createClient(
      supabaseUrl,
      getSupabasePublishableKey(),
      { global: { headers: { Authorization: authorization } } }
    )
    const { data, error } = await userClient.auth.getUser(
      authorization.slice('Bearer '.length)
    )
    if (error || !data.user) {
      return jsonResponse({ error: 'Сессия недействительна.' }, 401)
    }

    const admin = createClient(
      supabaseUrl,
      getRequiredSecret('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const body = await request.json() as SearchPlacesRequest
    return jsonResponse(
      await searchPlaces(body, data.user.id, userClient, admin)
    )
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500
    const message = error instanceof PublicError
      ? error.message
      : 'Не удалось получить места.'
    console.error(
      'Place discovery failed:',
      error instanceof Error ? error.name : 'Unknown error'
    )
    return jsonResponse({ error: message }, status)
  }
})

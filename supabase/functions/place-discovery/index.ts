import { createClient } from 'npm:@supabase/supabase-js@2'
import { conceptLabel, normalizeConcepts } from '../_shared/taxonomy.ts'

const FOURSQUARE_SEARCH_URL = 'https://places-api.foursquare.com/places/search'
const FOURSQUARE_API_VERSION = '2025-06-17'

type PlaceKind = 'restaurant' | 'cafe' | 'bar'

type SearchPlacesRequest = {
  action?: 'search_places' | 'personalized_places'
  kind?: PlaceKind
  city?: string
  limit?: number
  open_now?: boolean
  min_price?: number
  max_price?: number
  sort?: 'RELEVANCE' | 'DISTANCE' | 'RATING' | 'POPULARITY'
  offset?: number
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
  distance?: number
  categories?: FoursquareCategory[]
  fsq_category_labels?: string[]
  tel?: string
  email?: string
  website?: string
  social_media?: {
    instagram?: string
    facebook_id?: string
    twitter?: string
  }
  link?: string
  date_closed?: string
  chains?: Array<{
    id?: string
    name?: string
    fsq_chain_id?: string
    fsq_chain_name?: string
  }>
  store_id?: string
  related_places?: unknown
  unresolved_flags?: string[]
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
  locality: string | null
  region: string | null
  postcode: string | null
  lat: number | null
  lon: number | null
  distance_meters: number | null
  website: string | null
  phone: string | null
  email: string | null
  instagram: string | null
  facebook_id: string | null
  twitter: string | null
  chain_id: string | null
  chain_name: string | null
  is_chain: boolean
  store_id: string | null
  related_places: unknown | null
  date_closed: string | null
  unresolved_flags: string[]
  source_url: string | null
}

type CatalogPlace = NormalizedPlace & { catalog_id: string }

type PlaceAffinity = {
  kind: Map<string, number>
  category: Map<string, number>
  cuisine: Map<string, number>
  chain: Map<string, number>
}

const PLACE_RECOMMENDATION_WEIGHTS = {
  interested: 3,
  wishlist: 6,
  notInterested: -6,
  plan: 5,
  visited: 6,
  highRating: 7,
  goodRating: 3,
  mediocreRating: -3,
  lowRating: -7,
  keywordMatch: 0.75,
  maxKeywordScore: 2.25,
  existingInterested: 1,
  existingWishlist: 2,
} as const

const PREFERENCE_STOP_WORDS = new Set([
  'которые', 'который', 'которая', 'люблю', 'нравится', 'хочу', 'очень',
  'обычно', 'можно', 'чтобы', 'места',
  'также', 'просто', 'больше', 'меньше', 'рядом',
])

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

const FOURSQUARE_PRO_FIELDS = [
  'fsq_place_id',
  'name',
  'categories',
  'location',
  'latitude',
  'longitude',
  'distance',
  'tel',
  'email',
  'website',
  'social_media',
  'link',
  'date_closed',
  'chains',
  'store_id',
  'related_places',
  'unresolved_flags',
] as const

const DANGEROUS_UNRESOLVED_FLAGS = new Set([
  'doesnt_exist',
  'delete',
  'inappropriate',
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

function cuisineNames(categories: string[]) {
  return categories.filter((category) => {
    const normalized = category.toLocaleLowerCase('en-US')
    if (GENERIC_FOOD_CATEGORIES.has(normalized)) return false

    return normalized.includes('restaurant') ||
      normalized.includes('food') ||
      normalized.includes('coffee shop') ||
      normalized.includes('café') ||
      normalized.includes('cafe') ||
      normalized.includes('wine bar') ||
      normalized.includes('beer bar') ||
      normalized.includes('cocktail bar')
  })
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(optionalString).filter((item): item is string => Boolean(item)))]
}

function normalizedFlags(value: unknown) {
  return stringList(value).map((flag) => flag.toLocaleLowerCase('en-US').trim())
}

function shouldExcludePlace(place: FoursquarePlace) {
  if (optionalString(place.date_closed)) return true
  return normalizedFlags(place.unresolved_flags).some((flag) =>
    DANGEROUS_UNRESOLVED_FLAGS.has(flag)
  )
}

function normalizeFoursquarePlace(
  place: FoursquarePlace,
  kind: PlaceKind
): NormalizedPlace | null {
  const sourcePlaceId = optionalString(place.fsq_place_id ?? place.fsq_id)
  const name = optionalString(place.name)
  if (!sourcePlaceId || !name) return null

  const categories = categoryNames(place)
  const chain = place.chains?.[0]

  return {
    catalog_id: null,
    source: 'foursquare',
    source_place_id: sourcePlaceId,
    name,
    kind,
    categories,
    cuisine: cuisineNames(categories),
    address: normalizeAddress(place),
    locality: optionalString(place.location?.locality),
    region: optionalString(place.location?.region),
    postcode: optionalString(place.location?.postcode),
    lat: optionalNumber(place.latitude),
    lon: optionalNumber(place.longitude),
    distance_meters: optionalNumber(place.distance),
    website: optionalString(place.website),
    phone: optionalString(place.tel),
    email: optionalString(place.email),
    instagram: optionalString(place.social_media?.instagram),
    facebook_id: optionalString(place.social_media?.facebook_id),
    twitter: optionalString(place.social_media?.twitter),
    chain_id: optionalString(chain?.id ?? chain?.fsq_chain_id),
    chain_name: optionalString(chain?.name ?? chain?.fsq_chain_name),
    is_chain: Boolean(place.chains?.length),
    store_id: optionalString(place.store_id),
    related_places: place.related_places ?? null,
    date_closed: optionalString(place.date_closed),
    unresolved_flags: normalizedFlags(place.unresolved_flags),
    source_url: optionalString(place.link ?? place.placemaker_url),
  }
}

// Provider adapter: all Foursquare endpoint, auth, taxonomy and payload details
// are isolated here and in normalizeFoursquarePlace.
async function searchWithFoursquare(
  kind: PlaceKind,
  city: CityConfig,
  limit: number,
  filters: Pick<SearchPlacesRequest, 'open_now' | 'min_price' | 'max_price' | 'sort'>
) {
  const url = new URL(FOURSQUARE_SEARCH_URL)
  url.searchParams.set('ll', `${city.latitude},${city.longitude}`)
  url.searchParams.set('radius', String(city.radius))
  url.searchParams.set('fsq_category_ids', FOURSQUARE_CATEGORY_IDS[kind])
  url.searchParams.set('sort', filters.sort ?? 'RELEVANCE')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('tel_format', 'NATIONAL')
  url.searchParams.set('fields', FOURSQUARE_PRO_FIELDS.join(','))
  if (filters.open_now !== undefined) {
    url.searchParams.set('open_now', String(filters.open_now))
  }
  if (filters.min_price !== undefined) {
    url.searchParams.set('min_price', String(filters.min_price))
  }
  if (filters.max_price !== undefined) {
    url.searchParams.set('max_price', String(filters.max_price))
  }

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
    .filter((place) => !shouldExcludePlace(place))
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
  if (
    body.open_now !== undefined &&
    typeof body.open_now !== 'boolean'
  ) {
    throw new PublicError('Фильтр open_now должен быть логическим значением.')
  }
  for (const value of [body.min_price, body.max_price]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 4)) {
      throw new PublicError('Ценовой фильтр должен быть от 1 до 4.')
    }
  }
  if (
    body.min_price !== undefined &&
    body.max_price !== undefined &&
    body.min_price > body.max_price
  ) {
    throw new PublicError('Минимальная цена не может быть выше максимальной.')
  }
  if (
    body.sort !== undefined &&
    !['RELEVANCE', 'DISTANCE', 'RATING', 'POPULARITY'].includes(body.sort)
  ) {
    throw new PublicError('Неизвестный порядок сортировки.')
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
    body.limit ?? 20,
    body
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
    locality: normalized.locality,
    region: normalized.region,
    postcode: normalized.postcode,
    lat: normalized.lat,
    lon: normalized.lon,
    distance_meters: normalized.distance_meters,
    website: normalized.website,
    phone: normalized.phone,
    email: normalized.email,
    instagram: normalized.instagram,
    facebook_id: normalized.facebook_id,
    twitter: normalized.twitter,
    chain_id: normalized.chain_id,
    chain_name: normalized.chain_name,
    is_chain: normalized.is_chain,
    store_id: normalized.store_id,
    related_places: normalized.related_places,
    date_closed: normalized.date_closed,
    unresolved_flags: normalized.unresolved_flags,
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

function emptyAffinity(): PlaceAffinity {
  return {
    kind: new Map(),
    category: new Map(),
    cuisine: new Map(),
    chain: new Map(),
  }
}

function addWeight(map: Map<string, number>, values: string[], weight: number) {
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase('ru-RU')
    if (key) map.set(key, (map.get(key) ?? 0) + weight)
  }
}

function placeFeatures(place: CatalogPlace) {
  return {
    kind: [...new Set([place.kind, ...normalizeConcepts(place.kind)])],
    category: [...new Set([...place.categories, ...normalizeConcepts(place.categories)])],
    cuisine: [...new Set([...place.cuisine, ...normalizeConcepts(place.cuisine)])],
    chain: place.chain_name ? [place.chain_name] : [],
  }
}

function applyPlaceSignal(affinity: PlaceAffinity, place: CatalogPlace, weight: number) {
  const features = placeFeatures(place)
  addWeight(affinity.kind, features.kind, weight)
  addWeight(affinity.category, features.category, weight)
  addWeight(affinity.cuisine, features.cuisine, weight)
  addWeight(affinity.chain, features.chain, weight * 0.5)
}

function featureScore(map: Map<string, number>, values: string[]) {
  return values.reduce(
    (sum, value) => sum + (map.get(value.trim().toLocaleLowerCase('ru-RU')) ?? 0),
    0
  )
}

function preferenceTerms(text: string) {
  const terms = [...new Set(
    text
      .toLocaleLowerCase('ru-RU')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3 && !PREFERENCE_STOP_WORDS.has(term))
  )]
  return [...new Set([...terms, ...normalizeConcepts(text)])]
}

function catalogPlace(row: Record<string, unknown>): CatalogPlace {
  return {
    catalog_id: String(row.id),
    source: String(row.source ?? ''),
    source_place_id: String(row.source_place_id ?? ''),
    name: String(row.name ?? ''),
    kind: row.kind === 'cafe' || row.kind === 'bar' ? row.kind : 'restaurant',
    categories: stringList(row.categories),
    cuisine: stringList(row.cuisine),
    address: optionalString(row.address),
    locality: optionalString(row.locality),
    region: optionalString(row.region),
    postcode: optionalString(row.postcode),
    lat: optionalNumber(row.lat),
    lon: optionalNumber(row.lon),
    distance_meters: optionalNumber(row.distance_meters),
    website: optionalString(row.website),
    phone: optionalString(row.phone),
    email: optionalString(row.email),
    instagram: optionalString(row.instagram),
    facebook_id: optionalString(row.facebook_id),
    twitter: optionalString(row.twitter),
    chain_id: optionalString(row.chain_id),
    chain_name: optionalString(row.chain_name),
    is_chain: row.is_chain === true,
    store_id: optionalString(row.store_id),
    related_places: row.related_places ?? null,
    date_closed: optionalString(row.date_closed),
    unresolved_flags: normalizedFlags(row.unresolved_flags),
    source_url: optionalString(row.source_url),
  }
}

function placeSearchText(place: CatalogPlace) {
  return [
    place.name,
    place.kind,
    ...place.categories,
    ...place.cuisine,
    place.address,
    place.locality,
    place.chain_name,
  ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU')
}

function diversifyPlaces<T extends CatalogPlace & { recommendation_score: number }>(
  ranked: T[],
  limit: number
) {
  const remaining = [...ranked]
  const selected: T[] = []
  const kindCounts = new Map<string, number>()
  const cuisineCounts = new Map<string, number>()

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0
    let bestAdjustedScore = -Infinity
    remaining.forEach((place, index) => {
      const kindLimit = Math.max(2, Math.ceil(limit / 2))
      const hasAnotherKind = remaining.some(
        (candidate) => candidate.kind !== place.kind
      )
      if ((kindCounts.get(place.kind) ?? 0) >= kindLimit && hasAnotherKind) return

      const kindPenalty = (kindCounts.get(place.kind) ?? 0) * 0.8
      const cuisinePenalty = place.cuisine.reduce(
        (sum, cuisine) => sum + (cuisineCounts.get(cuisine) ?? 0) * 0.45,
        0
      )
      const adjustedScore = place.recommendation_score - kindPenalty - cuisinePenalty
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore
        bestIndex = index
      }
    })

    const selectedPlace = remaining.splice(bestIndex, 1)[0]
    selected.push(selectedPlace)
    kindCounts.set(selectedPlace.kind, (kindCounts.get(selectedPlace.kind) ?? 0) + 1)
    selectedPlace.cuisine.forEach((cuisine) =>
      cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1)
    )
  }
  return selected
}

async function personalizedPlaces(
  body: SearchPlacesRequest,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
) {
  const limit = body.limit ?? 8
  const offset = body.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new PublicError('Количество рекомендаций должно быть от 1 до 20.')
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) {
    throw new PublicError('Передано некорректное смещение рекомендаций.')
  }

  const { data: preferences, error: preferencesError } = await admin
    .from('user_preferences')
    .select('preference_text, city, onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle()
  if (preferencesError) {
    console.error('Place preferences query failed:', preferencesError.code)
    throw new PublicError('Не удалось загрузить ваши предпочтения.', 500)
  }

  const city = String(preferences?.city ?? '')
  const cityConfig = CITY_CONFIG[city]
  if (!cityConfig) throw new PublicError('Выберите город в профиле вкусов.')

  const { data: membership, error: membershipError } = await admin
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (membershipError) {
    console.error('Place membership query failed:', membershipError.code)
    throw new PublicError('Не удалось определить активную группу.', 500)
  }

  const catalogFields = [
    'id', 'source', 'source_place_id', 'name', 'kind', 'categories', 'cuisine',
    'address', 'locality', 'region', 'postcode', 'lat', 'lon', 'distance_meters',
    'website', 'phone', 'email', 'instagram', 'facebook_id', 'twitter',
    'chain_id', 'chain_name', 'is_chain', 'store_id', 'related_places',
    'date_closed', 'unresolved_flags', 'source_url',
  ].join(',')
  const loadCandidates = () => admin
    .from('place_catalog')
    .select(catalogFields)
    .eq('city', city)
    .is('date_closed', null)
    .order('last_seen_at', { ascending: false })
    .limit(150)

  let candidateResult = await loadCandidates()
  if (candidateResult.error) {
    console.error('Place candidates query failed:', candidateResult.error.code)
    throw new PublicError('Не удалось загрузить каталог мест.', 500)
  }

  if ((candidateResult.data ?? []).length < 18) {
    await Promise.all(
      (['restaurant', 'cafe', 'bar'] as PlaceKind[]).map((kind) =>
        searchPlaces(
          { action: 'search_places', kind, city, limit: 20 },
          userId,
          userClient,
          admin
        )
      )
    )
    candidateResult = await loadCandidates()
    if (candidateResult.error) {
      console.error('Refreshed place candidates query failed:', candidateResult.error.code)
      throw new PublicError('Не удалось обновить каталог мест.', 500)
    }
  }

  const candidates = (candidateResult.data ?? [])
    .map((row) => catalogPlace(row as Record<string, unknown>))
    .filter((place) =>
      !place.unresolved_flags.some((flag) => DANGEROUS_UNRESOLVED_FLAGS.has(flag))
    )

  const { data: feedbackRows, error: feedbackError } = await admin
    .from('place_feedback')
    .select('place_id, reaction')
    .eq('user_id', userId)
  if (feedbackError) {
    console.error('Place feedback query failed:', feedbackError.code)
    throw new PublicError('Не удалось загрузить историю реакций.', 500)
  }

  let planRows: Array<Record<string, unknown>> = []
  if (membership?.group_id) {
    const { data, error } = await admin
      .from('plans')
      .select('id, place_catalog_id, created_by')
      .eq('group_id', membership.group_id)
      .not('place_catalog_id', 'is', null)
    if (error) {
      console.error('Place plans query failed:', error.code)
      throw new PublicError('Не удалось загрузить сохранённые места.', 500)
    }
    planRows = data ?? []
  }

  const planIds = planRows.map((plan) => String(plan.id))
  let visitRows: Array<Record<string, unknown>> = []
  if (planIds.length > 0) {
    const { data, error } = await admin
      .from('plan_events')
      .select('id, plan_id')
      .in('plan_id', planIds)
      .lt('planned_at', new Date().toISOString())
    if (error) {
      console.error('Place visits query failed:', error.code)
      throw new PublicError('Не удалось загрузить историю посещений.', 500)
    }
    visitRows = data ?? []
  }

  let ratingRows: Array<Record<string, unknown>> = []
  const visitIds = visitRows.map((visit) => String(visit.id))
  if (visitIds.length > 0) {
    const { data, error } = await admin
      .from('event_ratings')
      .select('plan_event_id, score')
      .eq('user_id', userId)
      .in('plan_event_id', visitIds)
    if (error) {
      console.error('Place ratings query failed:', error.code)
      throw new PublicError('Не удалось загрузить историю оценок.', 500)
    }
    ratingRows = data ?? []
  }

  const historyIds = [...new Set([
    ...(feedbackRows ?? []).map((row) => String(row.place_id)),
    ...planRows.map((plan) => String(plan.place_catalog_id)),
  ].filter(Boolean))]
  const historyById = new Map<string, CatalogPlace>()
  if (historyIds.length > 0) {
    const { data, error } = await admin
      .from('place_catalog')
      .select(catalogFields)
      .in('id', historyIds)
    if (error) {
      console.error('Place history catalog query failed:', error.code)
      throw new PublicError('Не удалось построить профиль предпочтений.', 500)
    }
    for (const row of data ?? []) {
      const place = catalogPlace(row as Record<string, unknown>)
      historyById.set(place.catalog_id, place)
    }
  }

  const affinity = emptyAffinity()
  const feedbackByPlace = new Map<string, string>()
  const positiveFeatures = new Set<string>()
  const plannedFeatures = new Set<string>()
  const highlyRatedFeatures = new Set<string>()
  const featureKeys = (place: CatalogPlace) => [
    ...placeFeatures(place).cuisine,
    ...placeFeatures(place).category,
    ...placeFeatures(place).kind,
  ].map((value) => value.toLocaleLowerCase('ru-RU'))

  for (const row of feedbackRows ?? []) {
    const placeId = String(row.place_id)
    const reaction = String(row.reaction)
    feedbackByPlace.set(placeId, reaction)
    const place = historyById.get(placeId)
    if (!place) continue
    const weight = reaction === 'wishlist'
      ? PLACE_RECOMMENDATION_WEIGHTS.wishlist
      : reaction === 'interested'
        ? PLACE_RECOMMENDATION_WEIGHTS.interested
        : PLACE_RECOMMENDATION_WEIGHTS.notInterested
    applyPlaceSignal(affinity, place, weight)
    if (reaction === 'wishlist' || reaction === 'interested') {
      featureKeys(place).forEach((feature) => positiveFeatures.add(feature))
    }
  }

  const planById = new Map(planRows.map((plan) => [String(plan.id), plan]))
  for (const plan of planRows) {
    if (String(plan.created_by) !== userId) continue
    const place = historyById.get(String(plan.place_catalog_id))
    if (!place) continue
    applyPlaceSignal(affinity, place, PLACE_RECOMMENDATION_WEIGHTS.plan)
    featureKeys(place).forEach((feature) => plannedFeatures.add(feature))
  }

  const visitedPlaceIds = new Set<string>()
  for (const visit of visitRows) {
    const plan = planById.get(String(visit.plan_id))
    const placeId = String(plan?.place_catalog_id ?? '')
    const place = historyById.get(placeId)
    if (!place) continue
    visitedPlaceIds.add(placeId)
    applyPlaceSignal(affinity, place, PLACE_RECOMMENDATION_WEIGHTS.visited)
    const rating = ratingRows.find(
      (row) => String(row.plan_event_id) === String(visit.id)
    )
    const score = Number(rating?.score)
    const ratingWeight = score >= 8
      ? PLACE_RECOMMENDATION_WEIGHTS.highRating
      : score >= 6
        ? PLACE_RECOMMENDATION_WEIGHTS.goodRating
        : score > 0 && score <= 3
          ? PLACE_RECOMMENDATION_WEIGHTS.lowRating
          : score > 0 && score <= 5
            ? PLACE_RECOMMENDATION_WEIGHTS.mediocreRating
            : 0
    applyPlaceSignal(affinity, place, ratingWeight)
    if (score >= 8) featureKeys(place).forEach((feature) => highlyRatedFeatures.add(feature))
  }

  const terms = preferenceTerms(String(preferences?.preference_text ?? ''))
  const plansByPlace = new Set(planRows.map((plan) => String(plan.place_catalog_id)))
  const scored = candidates
    .filter((place) =>
      feedbackByPlace.get(place.catalog_id) !== 'not_interested' &&
      !visitedPlaceIds.has(place.catalog_id)
    )
    .map((place) => {
      const features = placeFeatures(place)
      const affinityScore =
        featureScore(affinity.kind, features.kind) +
        featureScore(affinity.category, features.category) +
        featureScore(affinity.cuisine, features.cuisine) +
        featureScore(affinity.chain, features.chain)
      const matchedTerms = terms.filter((term) => placeSearchText(place).includes(term))
      const keywordScore = Math.min(
        matchedTerms.length * PLACE_RECOMMENDATION_WEIGHTS.keywordMatch,
        PLACE_RECOMMENDATION_WEIGHTS.maxKeywordScore
      )
      const reaction = feedbackByPlace.get(place.catalog_id)
      const directScore = reaction === 'wishlist'
        ? PLACE_RECOMMENDATION_WEIGHTS.existingWishlist
        : reaction === 'interested'
          ? PLACE_RECOMMENDATION_WEIGHTS.existingInterested
          : 0
      const keys = featureKeys(place)
      const reasons: string[] = []
      const ratedMatch = keys.find((key) => highlyRatedFeatures.has(key))
      const positiveMatch = keys.find((key) => positiveFeatures.has(key))
      const plannedMatch = keys.find((key) => plannedFeatures.has(key))
      if (ratedMatch) {
        reasons.push('Похоже на места, которые вы высоко оценивали')
      } else if (positiveMatch) {
        const concept = normalizeConcepts(positiveMatch)[0]
        reasons.push(`Вам нравятся похожие места: ${concept ? conceptLabel(concept) : positiveMatch}`)
      } else if (plannedMatch) {
        reasons.push('Похоже на места, которые вы добавляли в планы')
      }
      if (matchedTerms.length > 0) {
        reasons.push(`Совпадает с вашими предпочтениями: ${matchedTerms.slice(0, 2).join(', ')}`)
      }

      return {
        ...place,
        reaction: reaction ?? null,
        is_in_plans: plansByPlace.has(place.catalog_id),
        recommendation_score: affinityScore + keywordScore + directScore,
        reasons: reasons.slice(0, 2),
      }
    })
    .sort((a, b) =>
      b.recommendation_score - a.recommendation_score ||
      a.name.localeCompare(b.name, 'ru')
    )

  const rotated = scored.length > 0
    ? [...scored.slice(offset % scored.length), ...scored.slice(0, offset % scored.length)]
    : []
  return {
    city,
    recommendations: diversifyPlaces(rotated, limit),
    feedback_count: (feedbackRows ?? []).length,
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
      body.action === 'personalized_places'
        ? await personalizedPlaces(body, data.user.id, userClient, admin)
        : await searchPlaces(body, data.user.id, userClient, admin)
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

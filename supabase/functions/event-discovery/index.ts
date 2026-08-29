import { createClient } from 'npm:@supabase/supabase-js@2'
import { conceptLabel, normalizeConcepts } from '../_shared/taxonomy.ts'

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
  action?: 'search_events' | 'personalized_recommendations'
  location?: string
  actual_since?: number
  actual_until?: number
  page_size?: number
  categories?: string[]
  is_free?: boolean
  limit?: number
  offset?: number
}

type NormalizedEvent = ReturnType<typeof normalizeEvent> & {
  catalog_id: string
}

type RecommendationSignal = {
  categoryAffinity: Map<string, number>
  positiveFeedbackCategories: Set<string>
  planCategories: Set<string>
  highlyRatedCategories: Set<string>
}

const RECOMMENDATION_WEIGHTS = {
  wishlistCategory: 5,
  interestedCategory: 3,
  notInterestedCategory: -4,
  planCategory: 2,
  visitedCategory: 4,
  highRatingCategory: 5,
  goodRatingCategory: 2,
  lowRatingCategory: -5,
  mediocreRatingCategory: -2,
  keywordMatch: 0.75,
  maxKeywordScore: 3,
} as const

const PREFERENCE_STOP_WORDS = new Set([
  'которые', 'который', 'которая', 'люблю', 'нравится', 'хочу', 'очень',
  'обычно', 'можно', 'чтобы', 'мероприятия', 'места', 'форматы', 'готов',
  'готова', 'рублей', 'также', 'просто', 'больше', 'меньше',
])

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

function getSupabaseServiceRoleKey() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!key) {
    throw new PublicError('Серверное сохранение каталога не настроено.')
  }

  return key
}

function validateSearch(body: SearchRequest) {
  if (
    body.action !== 'search_events' &&
    body.action !== 'personalized_recommendations'
  ) {
    return 'Неизвестное действие.'
  }

  if (body.action === 'personalized_recommendations') {
    if (
      body.limit !== undefined &&
      (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)
    ) {
      return 'Количество рекомендаций должно быть от 1 до 20.'
    }

    if (
      body.offset !== undefined &&
      (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 1000)
    ) {
      return 'Передано некорректное смещение рекомендаций.'
    }

    return null
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

async function searchKudaGoEvents(
  body: SearchRequest,
  admin: ReturnType<typeof createClient>
) {
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
  const normalizedBySourceId = new Map<string, {
    event: ReturnType<typeof normalizeEvent>
    payload: KudaGoEvent
  }>()

  for (const payload of data.results ?? []) {
    const event = normalizeEvent(
      payload,
      Number(body.actual_since),
      Number(body.actual_until)
    )

    if (event.source_id && event.title && event.source_url) {
      normalizedBySourceId.set(event.source_id, { event, payload })
    }
  }

  const normalizedEvents = [...normalizedBySourceId.values()]
  const seenAt = new Date().toISOString()
  const catalogRows = normalizedEvents.map(({ event, payload }) => ({
    source: event.source,
    source_event_id: event.source_id,
    title: event.title,
    description: event.description,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    place_name: event.place_name,
    address: event.address,
    price: event.price,
    is_free: event.is_free,
    image_url: event.image_url,
    source_url: event.source_url,
    categories: event.categories,
    city: body.location,
    age_restriction: event.age_restriction,
    source_payload: payload,
    last_seen_at: seenAt,
  }))

  if (catalogRows.length === 0) {
    return { source: 'kudago', total: data.count ?? 0, events: [] }
  }

  const { data: catalogData, error: catalogError } = await admin
    .from('event_catalog')
    .upsert(catalogRows, { onConflict: 'source,source_event_id' })
    .select('id, source, source_event_id')

  if (catalogError) {
    console.error('Event catalog upsert failed:', catalogError.code)
    throw new PublicError('Не удалось сохранить найденные мероприятия.')
  }

  const catalogIds = new Map(
    (catalogData ?? []).map((row) => [
      `${String(row.source)}:${String(row.source_event_id)}`,
      String(row.id),
    ])
  )
  const events = normalizedEvents
    .map(({ event }) => ({
      ...event,
      catalog_id: catalogIds.get(`${event.source}:${event.source_id}`) ?? '',
    }))
    .filter((event) => event.catalog_id)

  return { source: 'kudago', total: data.count ?? events.length, events }
}

function preferenceTerms(value: string) {
  const normalized = value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = normalized.split(' ')
  const isMeaningful = (word: string) =>
    word.length >= 4 && !PREFERENCE_STOP_WORDS.has(word)
  const terms = words.filter(isMeaningful)

  for (let index = 0; index < words.length - 1; index += 1) {
    if (isMeaningful(words[index]) && isMeaningful(words[index + 1])) {
      terms.push(`${words[index]} ${words[index + 1]}`)
    }
  }

  return [...new Set([...terms, ...normalizeConcepts(value)])].slice(0, 30)
}

function recommendationCategories(categories: string[]) {
  return [...new Set([...categories, ...normalizeConcepts(categories)])]
}

function eventSearchText(event: NormalizedEvent) {
  return [
    event.title,
    event.description,
    event.place_name,
    ...event.categories,
    ...normalizeConcepts(event.categories),
  ].join(' ').toLocaleLowerCase('ru-RU')
}

function addCategoryWeight(
  profile: Map<string, number>,
  categories: string[],
  weight: number
) {
  for (const category of recommendationCategories(categories)) {
    profile.set(category, (profile.get(category) ?? 0) + weight)
  }
}

function diversifyRecommendations<T extends { categories: string[] }>(
  ranked: T[],
  limit: number
) {
  const remaining = [...ranked]
  const selected: T[] = []

  while (remaining.length > 0 && selected.length < limit) {
    const recentCategories = selected
      .slice(-2)
      .map((event) => event.categories[0] || 'other')
    let nextIndex = remaining.findIndex((event) => {
      const category = event.categories[0] || 'other'
      return !(
        recentCategories.length === 2 &&
        recentCategories.every((recent) => recent === category)
      )
    })

    if (nextIndex < 0) nextIndex = 0
    selected.push(remaining.splice(nextIndex, 1)[0])
  }

  return selected
}

async function personalizedRecommendations(
  body: SearchRequest,
  userId: string,
  admin: ReturnType<typeof createClient>
) {
  const { data: preferences, error: preferencesError } = await admin
    .from('user_preferences')
    .select('preference_text, city, onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle()

  if (preferencesError) {
    console.error('Preferences query failed:', preferencesError.code)
    throw new PublicError('Не удалось загрузить ваши предпочтения.')
  }

  if (!preferences?.onboarding_completed) {
    return { onboarding_required: true, recommendations: [] }
  }

  const city = String(preferences.city ?? '')
  if (!ALLOWED_LOCATIONS.has(city)) {
    throw new PublicError('Выберите город в профиле вкусов.')
  }

  const { data: membership, error: membershipError } = await admin
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membershipError) {
    console.error('Membership query failed:', membershipError.code)
    throw new PublicError('Не удалось определить активную группу.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const fresh = await searchKudaGoEvents(
    {
      action: 'search_events',
      location: city,
      actual_since: nowSeconds,
      actual_until: nowSeconds + 30 * 24 * 60 * 60,
      page_size: 100,
    },
    admin
  )
  const candidates = fresh.events as NormalizedEvent[]

  const { data: feedbackRows, error: feedbackError } = await admin
    .from('event_feedback')
    .select('event_id, reaction')
    .eq('user_id', userId)

  if (feedbackError) {
    console.error('Feedback query failed:', feedbackError.code)
    throw new PublicError('Не удалось загрузить историю реакций.')
  }

  let planRows: Array<{
    id: unknown
    event_catalog_id: unknown
    created_by: unknown
  }> = []
  if (membership?.group_id) {
    const { data, error } = await admin
      .from('plans')
      .select('id, event_catalog_id, created_by')
      .eq('group_id', membership.group_id)
      .not('event_catalog_id', 'is', null)

    if (error) {
      console.error('Plans query failed:', error.code)
      throw new PublicError('Не удалось загрузить сохранённые планы.')
    }
    planRows = data ?? []
  }

  const planIds = planRows.map((plan) => String(plan.id))
  let visitedRows: Array<{ id: unknown; plan_id: unknown }> = []
  if (planIds.length > 0) {
    const { data, error } = await admin
      .from('plan_events')
      .select('id, plan_id')
      .in('plan_id', planIds)
      .lt('planned_at', new Date().toISOString())

    if (error) {
      console.error('Plan events query failed:', error.code)
      throw new PublicError('Не удалось загрузить историю посещений.')
    }
    visitedRows = data ?? []
  }

  const visitedPlanIds = new Set(visitedRows.map((event) => String(event.plan_id)))
  const visitedEventIds = new Set(
    planRows
      .filter((plan) => visitedPlanIds.has(String(plan.id)))
      .map((plan) => String(plan.event_catalog_id))
  )
  const visitedPlanEventIds = visitedRows.map((event) => String(event.id))
  let ratingRows: Array<{ plan_event_id: unknown; score: unknown }> = []
  if (visitedPlanEventIds.length > 0) {
    const { data, error } = await admin
      .from('event_ratings')
      .select('plan_event_id, score')
      .eq('user_id', userId)
      .in('plan_event_id', visitedPlanEventIds)

    if (error) {
      console.error('Ratings query failed:', error.code)
      throw new PublicError('Не удалось загрузить историю оценок.')
    }
    ratingRows = data ?? []
  }

  const historyEventIds = [...new Set([
    ...(feedbackRows ?? []).map((row) => String(row.event_id)),
    ...planRows.map((plan) => String(plan.event_catalog_id)),
  ].filter(Boolean))]
  const historyCatalog = new Map<string, { categories: string[] }>()

  if (historyEventIds.length > 0) {
    const { data, error } = await admin
      .from('event_catalog')
      .select('id, categories')
      .in('id', historyEventIds)

    if (error) {
      console.error('History catalog query failed:', error.code)
      throw new PublicError('Не удалось построить профиль интересов.')
    }

    for (const event of data ?? []) {
      historyCatalog.set(String(event.id), {
        categories: Array.isArray(event.categories) ? event.categories : [],
      })
    }
  }

  const signals: RecommendationSignal = {
    categoryAffinity: new Map(),
    positiveFeedbackCategories: new Set(),
    planCategories: new Set(),
    highlyRatedCategories: new Set(),
  }
  const feedbackByEvent = new Map<string, string>()

  for (const row of feedbackRows ?? []) {
    const eventId = String(row.event_id)
    const reaction = String(row.reaction)
    const categories = historyCatalog.get(eventId)?.categories ?? []
    feedbackByEvent.set(eventId, reaction)
    const weight = reaction === 'wishlist'
      ? RECOMMENDATION_WEIGHTS.wishlistCategory
      : reaction === 'interested'
        ? RECOMMENDATION_WEIGHTS.interestedCategory
        : RECOMMENDATION_WEIGHTS.notInterestedCategory
    addCategoryWeight(signals.categoryAffinity, categories, weight)
    if (reaction === 'wishlist' || reaction === 'interested') {
      recommendationCategories(categories).forEach((category) => signals.positiveFeedbackCategories.add(category))
    }
  }

  const planById = new Map(planRows.map((plan) => [String(plan.id), plan]))
  for (const plan of planRows) {
    if (String(plan.created_by) !== userId) continue
    const categories = historyCatalog.get(String(plan.event_catalog_id))?.categories ?? []
    addCategoryWeight(signals.categoryAffinity, categories, RECOMMENDATION_WEIGHTS.planCategory)
    recommendationCategories(categories).forEach((category) => signals.planCategories.add(category))
  }

  for (const visited of visitedRows) {
    const plan = planById.get(String(visited.plan_id))
    const categories = plan
      ? historyCatalog.get(String(plan.event_catalog_id))?.categories ?? []
      : []
    addCategoryWeight(signals.categoryAffinity, categories, RECOMMENDATION_WEIGHTS.visitedCategory)
    const rating = ratingRows.find(
      (row) => String(row.plan_event_id) === String(visited.id)
    )
    const score = Number(rating?.score)
    const ratingWeight = score >= 8
      ? RECOMMENDATION_WEIGHTS.highRatingCategory
      : score >= 6
        ? RECOMMENDATION_WEIGHTS.goodRatingCategory
        : score > 0 && score <= 3
          ? RECOMMENDATION_WEIGHTS.lowRatingCategory
          : score > 0 && score <= 5
            ? RECOMMENDATION_WEIGHTS.mediocreRatingCategory
            : 0
    addCategoryWeight(signals.categoryAffinity, categories, ratingWeight)
    if (score >= 8) {
      recommendationCategories(categories).forEach((category) => signals.highlyRatedCategories.add(category))
    }
  }

  const terms = preferenceTerms(String(preferences.preference_text ?? ''))
  const planEventIds = new Set(planRows.map((plan) => String(plan.event_catalog_id)))
  const scored = candidates
    .filter((event) => {
      const startsAt = event.starts_at ? Date.parse(event.starts_at) : NaN
      return Number.isFinite(startsAt) && startsAt > Date.now() &&
        feedbackByEvent.get(event.catalog_id) !== 'not_interested' &&
        !visitedEventIds.has(event.catalog_id)
    })
    .map((event) => {
      const eventCategories = recommendationCategories(event.categories)
      const categoryScore = eventCategories.reduce(
        (total, category) => total + (signals.categoryAffinity.get(category) ?? 0),
        0
      )
      const matchedTerms = terms.filter((term) => eventSearchText(event).includes(term))
      const keywordScore = Math.min(
        matchedTerms.length * RECOMMENDATION_WEIGHTS.keywordMatch,
        RECOMMENDATION_WEIGHTS.maxKeywordScore
      )
      const reasons: string[] = []
      const positiveCategory = eventCategories.find((category) =>
        signals.positiveFeedbackCategories.has(category)
      )
      const ratedCategory = eventCategories.find((category) =>
        signals.highlyRatedCategories.has(category)
      )
      const plannedCategory = eventCategories.find((category) =>
        signals.planCategories.has(category)
      )

      if (ratedCategory) {
        const concept = normalizeConcepts(ratedCategory)[0]
        reasons.push(`Вы высоко оценивали похожие события категории «${concept ? conceptLabel(concept) : ratedCategory}»`)
      } else if (positiveCategory) {
        const concept = normalizeConcepts(positiveCategory)[0]
        reasons.push(`Вы отмечали события категории «${concept ? conceptLabel(concept) : positiveCategory}» как интересные`)
      } else if (plannedCategory) {
        const concept = normalizeConcepts(plannedCategory)[0]
        reasons.push(`Похоже на события категории «${concept ? conceptLabel(concept) : plannedCategory}», которые вы добавляли в планы`)
      }
      if (matchedTerms.length > 0) {
        reasons.push(`Совпадает с вашими предпочтениями: ${matchedTerms.slice(0, 2).join(', ')}`)
      }

      return {
        ...event,
        reaction: feedbackByEvent.get(event.catalog_id) ?? null,
        is_in_plans: planEventIds.has(event.catalog_id),
        recommendation_score: categoryScore + keywordScore,
        reasons: reasons.slice(0, 2),
      }
    })
    .sort((a, b) =>
      b.recommendation_score - a.recommendation_score ||
      Date.parse(a.starts_at ?? '') - Date.parse(b.starts_at ?? '')
    )

  const limit = body.limit ?? 10
  const offset = body.offset ?? 0
  const rotated = scored.length > 0
    ? [...scored.slice(offset % scored.length), ...scored.slice(0, offset % scored.length)]
    : []
  const recommendations = diversifyRecommendations(rotated, limit)

  return {
    onboarding_required: false,
    city,
    recommendations,
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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      getSupabaseServiceRoleKey(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const body = await request.json() as SearchRequest
    const validationError = validateSearch(body)

    if (validationError) {
      return jsonResponse({ error: validationError }, 400)
    }

    if (body.action === 'personalized_recommendations') {
      return jsonResponse(
        await personalizedRecommendations(body, data.user.id, admin)
      )
    }

    return jsonResponse(await searchKudaGoEvents(body, admin))
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

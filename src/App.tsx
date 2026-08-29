import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { displayCategoryValues } from '../supabase/functions/_shared/taxonomy'

type Plan = {
  id: string
  event_catalog_id?: string | null
  place_catalog_id?: string | null
  title: string
  type: string
  price: string
  address: string
  link: string
  note: string
  tags: string[]
  created_at?: string
}

type PlanEvent = {
  id: string
  plan_id: string
  planned_at: string
  comment: string
  status: string
  created_at?: string
}

type PlanDesire = {
  id: string
  plan_id: string
  user_id: string
  score: number
  comment: string
  created_at?: string
  updated_at?: string
}

type EventRating = {
  id: string
  plan_event_id: string
  user_id: string
  score: number
  comment: string
  created_at?: string
  updated_at?: string
}

type RatingSummary = {
  entity_id: string
  average: number
  count: number
}

type AppView =
  | 'home'
  | 'recommendations'
  | 'places'
  | 'calendar'
  | 'ranking'
  | 'discovery'
  | 'group'
  | 'profile'
type AuthMode = 'login' | 'register'
type CalendarMode = 'month' | 'list'

type Group = {
  id: string
  name: string
  created_by: string
  invite_code: string
  created_at?: string
}

type Profile = {
  id: string
  email: string
  display_name: string
  created_at?: string
}

type GroupMember = {
  user_id: string
  email: string
  display_name: string
  role: string
  joined_at?: string
}

type DiscoveryEvent = {
  catalog_id: string
  source: 'kudago'
  source_id: string
  title: string
  description: string
  starts_at: string | null
  ends_at: string | null
  place_name: string
  address: string
  price: string
  is_free: boolean
  image_url: string
  source_url: string
  categories: string[]
  age_restriction: string
}

type RecommendationEvent = DiscoveryEvent & {
  recommendation_score: number
  reasons: string[]
  reaction: EventReaction | null
  is_in_plans: boolean
}

type EventReaction = 'interested' | 'not_interested' | 'wishlist'
type PlaceReaction = EventReaction
type OnboardingStep = 'preferences' | 'calibration' | 'complete' | null

type UserPreferences = {
  user_id: string
  preference_text: string
  city: string
  onboarding_completed: boolean
  calibration_completed_at?: string | null
}

type PlaceKind = 'restaurant' | 'cafe' | 'bar'

type DiscoveredPlace = {
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

type RecommendationPlace = DiscoveredPlace & {
  catalog_id: string
  recommendation_score: number
  reasons: string[]
  reaction: PlaceReaction | null
  is_in_plans: boolean
}

const DISCOVERY_LOCATIONS = [
  { slug: 'msk', name: 'Москва' },
  { slug: 'spb', name: 'Санкт-Петербург' },
] as const

const DISCOVERY_PERIODS = [
  { days: 1, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
] as const

const PLACE_KINDS = [
  { kind: 'restaurant', label: '🍽 Рестораны' },
  { kind: 'cafe', label: '☕ Кафе' },
  { kind: 'bar', label: '🍸 Бары' },
] as const

function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimeValue(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function formatCalendarDate(value: Date) {
  const todayDate = new Date()
  const tomorrowDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + 1)
  const today = localDateKey(todayDate)
  const tomorrow = localDateKey(tomorrowDate)
  const key = localDateKey(value)
  if (key === today) return 'Сегодня'
  if (key === tomorrow) return 'Завтра'
  return value.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: value.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')

  const [activeGroup, setActiveGroup] = useState<Group | null>(null)
  const [activeGroupRole, setActiveGroupRole] = useState('member')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('Наши планы')
  const [joinCode, setJoinCode] = useState(() => {
    const inviteFromUrl = new URLSearchParams(window.location.search).get('invite')
    return inviteFromUrl?.trim().toUpperCase() ?? ''
  })
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [editingGroupName, setEditingGroupName] = useState(false)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [groupNameBusy, setGroupNameBusy] = useState(false)
  const [groupNameError, setGroupNameError] = useState('')
  const [discoveryLocation, setDiscoveryLocation] = useState('msk')
  const [discoveryPeriod, setDiscoveryPeriod] = useState(7)
  const [discoveryEvents, setDiscoveryEvents] = useState<DiscoveryEvent[]>([])
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoverySearched, setDiscoverySearched] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveryFeedback, setDiscoveryFeedback] = useState<
    Record<string, EventReaction>
  >({})
  const [discoveryFeedbackBusy, setDiscoveryFeedbackBusy] = useState('')
  const [discoveryFeedbackError, setDiscoveryFeedbackError] = useState('')
  const [showHiddenDiscoveryEvents, setShowHiddenDiscoveryEvents] =
    useState(false)
  const [discoveryPlanBusy, setDiscoveryPlanBusy] = useState('')
  const [discoveryPlanMessage, setDiscoveryPlanMessage] = useState('')
  const [discoveryPlanError, setDiscoveryPlanError] = useState('')
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  const [preferencesError, setPreferencesError] = useState('')
  const [preferencesEditing, setPreferencesEditing] = useState(false)
  const [preferencesMessage, setPreferencesMessage] = useState('')
  const [preferenceTextDraft, setPreferenceTextDraft] = useState('')
  const [preferenceCityDraft, setPreferenceCityDraft] = useState('msk')
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null)
  const [calibrationEvents, setCalibrationEvents] = useState<DiscoveryEvent[]>([])
  const [calibrationIndex, setCalibrationIndex] = useState(0)
  const [calibrationLoading, setCalibrationLoading] = useState(false)
  const [calibrationBusy, setCalibrationBusy] = useState(false)
  const [calibrationError, setCalibrationError] = useState('')
  const [recommendations, setRecommendations] =
    useState<RecommendationEvent[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [recommendationsSearched, setRecommendationsSearched] = useState(false)
  const [recommendationsError, setRecommendationsError] = useState('')
  const [recommendationsOffset, setRecommendationsOffset] = useState(0)
  const [recommendationsFeedbackCount, setRecommendationsFeedbackCount] =
    useState(0)
  const [placeRecommendations, setPlaceRecommendations] =
    useState<RecommendationPlace[]>([])
  const [placeRecommendationsLoading, setPlaceRecommendationsLoading] = useState(false)
  const [placeRecommendationsSearched, setPlaceRecommendationsSearched] = useState(false)
  const [placeRecommendationsError, setPlaceRecommendationsError] = useState('')
  const [placeRecommendationsOffset, setPlaceRecommendationsOffset] = useState(0)
  const [placeRecommendationsFeedbackCount, setPlaceRecommendationsFeedbackCount] =
    useState(0)
  const [placeKind, setPlaceKind] = useState<PlaceKind>('restaurant')
  const [placeCity, setPlaceCity] = useState('')
  const [places, setPlaces] = useState<DiscoveredPlace[]>([])
  const [placesLoading, setPlacesLoading] = useState(false)
  const [placesSearched, setPlacesSearched] = useState(false)
  const [placesError, setPlacesError] = useState('')
  const [placeFeedback, setPlaceFeedback] = useState<Record<string, PlaceReaction>>({})
  const [placeFeedbackBusy, setPlaceFeedbackBusy] = useState('')
  const [placeFeedbackError, setPlaceFeedbackError] = useState('')
  const [showHiddenPlaces, setShowHiddenPlaces] = useState(false)
  const [placePlanBusy, setPlacePlanBusy] = useState('')
  const [placePlanMessage, setPlacePlanMessage] = useState('')
  const [placePlanError, setPlacePlanError] = useState('')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month')
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  )
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(
    () => localDateKey(new Date())
  )
  const [showPastCalendarEvents, setShowPastCalendarEvents] = useState(false)
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<PlanEvent | null>(null)
  const [calendarEditDate, setCalendarEditDate] = useState('')
  const [calendarEditTime, setCalendarEditTime] = useState('')
  const [calendarEditComment, setCalendarEditComment] = useState('')
  const [calendarEventBusy, setCalendarEventBusy] = useState(false)
  const [calendarError, setCalendarError] = useState('')

  const [plans, setPlans] = useState<Plan[]>([])
  const [planEvents, setPlanEvents] = useState<PlanEvent[]>([])
  const [planDesires, setPlanDesires] = useState<PlanDesire[]>([])
  const [eventRatings, setEventRatings] = useState<EventRating[]>([])
  const [planDesireSummaries, setPlanDesireSummaries] = useState<RatingSummary[]>([])
  const [eventRatingSummaries, setEventRatingSummaries] = useState<RatingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [search, setSearch] = useState('')
  const [activeView, setActiveView] = useState<AppView>('home')
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [schedulingPlan, setSchedulingPlan] = useState<Plan | null>(null)
  const [desirePlan, setDesirePlan] = useState<Plan | null>(null)
  const [ratingEvent, setRatingEvent] = useState<PlanEvent | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newLink, setNewLink] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newTags, setNewTags] = useState('')

  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editLink, setEditLink] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editTags, setEditTags] = useState('')

  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleComment, setScheduleComment] = useState('')

  const [desireScore, setDesireScore] = useState('')
  const [desireComment, setDesireComment] = useState('')

  const [factScore, setFactScore] = useState('')
  const [factComment, setFactComment] = useState('')

  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return
      }

      if (error) {
        console.error('Ошибка проверки сессии:', error)
        setAuthError('Не удалось проверить вход в приложение.')
      }

      setSession(data.session)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setActiveGroup(null)
      setActiveGroupRole('member')
      setWorkspaceLoading(false)
      setPlans([])
      setPlanEvents([])
      setPlanDesires([])
      setEventRatings([])
      setPlanDesireSummaries([])
      setEventRatingSummaries([])
      setProfile(null)
      setProfileName('')
      setGroupMembers([])
      setUserPreferences(null)
      setPreferencesLoading(false)
      setOnboardingStep(null)
      setCalibrationEvents([])
      setCalibrationIndex(0)
      setRecommendations([])
      setRecommendationsSearched(false)
      setRecommendationsOffset(0)
      setRecommendationsFeedbackCount(0)
      setPlaceRecommendations([])
      setPlaceRecommendationsSearched(false)
      setPlaceRecommendationsOffset(0)
      setPlaceRecommendationsFeedbackCount(0)
      setPlaces([])
      setPlacesSearched(false)
      setPlaceCity('')
      setPlaceFeedback({})
      setPlaceFeedbackBusy('')
      setPlaceFeedbackError('')
      setShowHiddenPlaces(false)
      setPlacePlanBusy('')
      setPlacePlanMessage('')
      setPlacePlanError('')
      setSelectedPlan(null)
      setEditingPlan(null)
      setSchedulingPlan(null)
      setDesirePlan(null)
      setRatingEvent(null)
      setActiveView('home')
      setLoading(false)
      return
    }

    setNow(Date.now())
    initializeWorkspace()

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [session])

  function switchAuthMode(mode: AuthMode) {
    setAuthMode(mode)
    setAuthError('')
    setAuthMessage('')
  }

  async function handleAuth() {
    const email = authEmail.trim().toLowerCase()
    const password = authPassword

    if (!email) {
      setAuthError('Введите email.')
      return
    }

    if (password.length < 6) {
      setAuthError('Пароль должен содержать минимум 6 символов.')
      return
    }

    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error('Ошибка входа:', error)
        setAuthError('Не удалось войти. Проверьте email и пароль.')
        setAuthBusy(false)
        return
      }

      setAuthPassword('')
      setAuthBusy(false)
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      console.error('Ошибка регистрации:', error)
      setAuthError(error.message)
      setAuthBusy(false)
      return
    }

    setAuthPassword('')

    if (data.session) {
      setAuthMessage('Аккаунт создан. Вы вошли в приложение.')
    } else {
      setAuthMessage(
        'Аккаунт создан. Если подтверждение email включено в Supabase, проверьте почту и подтвердите адрес.'
      )
      setAuthMode('login')
    }

    setAuthBusy(false)
  }

  async function handleSignOut() {
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')

    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Ошибка выхода:', error)
      setAuthError('Не удалось выйти из аккаунта.')
      setAuthBusy(false)
      return
    }

    setAuthEmail('')
    setAuthPassword('')
    setAuthMode('login')
    setActiveGroup(null)
    setActiveGroupRole('member')
    setWorkspaceName('Наши планы')
    setJoinCode('')
    setWorkspaceError('')
    setInviteCopied(false)
    setShowHiddenDiscoveryEvents(false)
    setAuthBusy(false)
  }

  async function initializeWorkspace() {
    if (!session) {
      return
    }

    setWorkspaceLoading(true)
    setWorkspaceError('')
    setLoading(true)

    const { data: membership, error: membershipError } = await supabase
      .from('group_members')
      .select('group_id, role, joined_at')
      .eq('user_id', session.user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError) {
      console.error('Ошибка загрузки пространства:', membershipError)
      setWorkspaceError('Не удалось проверить общее пространство.')
      setWorkspaceLoading(false)
      setLoading(false)
      return
    }

    if (!membership) {
      setActiveGroup(null)
      setWorkspaceLoading(false)
      setLoading(false)
      return
    }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', membership.group_id)
      .single()

    if (groupError) {
      console.error('Ошибка загрузки группы:', groupError)
      setWorkspaceError('Не удалось открыть общее пространство.')
      setWorkspaceLoading(false)
      setLoading(false)
      return
    }

    const loadedGroup: Group = {
      id: String(group.id),
      name: group.name ?? 'Наши планы',
      created_by: String(group.created_by),
      invite_code: String(group.invite_code ?? ''),
      created_at: group.created_at ?? undefined,
    }

    setActiveGroup(loadedGroup)
    setActiveGroupRole(String(membership.role ?? 'member'))
    setWorkspaceLoading(false)
    await Promise.all([
      loadAppData(loadedGroup.id),
      loadProfile(),
      loadGroupMembers(loadedGroup.id),
      loadUserPreferences(),
    ])
  }

  async function createWorkspace() {
    if (!session) {
      return
    }

    const name = workspaceName.trim()

    if (!name) {
      setWorkspaceError('Введите название пространства.')
      return
    }

    setWorkspaceBusy(true)
    setWorkspaceError('')

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({
        name,
        created_by: session.user.id,
      })
      .select()
      .single()

    if (groupError) {
      console.error('Ошибка создания пространства:', groupError)
      setWorkspaceError('Не удалось создать пространство.')
      setWorkspaceBusy(false)
      return
    }

    const { error: memberError } = await supabase
      .from('group_members')
      .insert({
        group_id: group.id,
        user_id: session.user.id,
        role: 'owner',
      })

    if (memberError) {
      console.error('Ошибка добавления владельца:', memberError)

      await supabase
        .from('groups')
        .delete()
        .eq('id', group.id)

      setWorkspaceError('Не удалось добавить владельца пространства.')
      setWorkspaceBusy(false)
      return
    }

    const { error: migrationError } = await supabase
      .from('plans')
      .update({
        group_id: group.id,
        created_by: session.user.id,
      })
      .is('group_id', null)

    if (migrationError) {
      console.error('Ошибка переноса старых планов:', migrationError)
      setWorkspaceError(
        'Пространство создано, но старые планы не удалось привязать автоматически.'
      )
    }

    const createdGroup: Group = {
      id: String(group.id),
      name: group.name ?? name,
      created_by: String(group.created_by),
      invite_code: String(group.invite_code ?? ''),
      created_at: group.created_at ?? undefined,
    }

    setActiveGroup(createdGroup)
    setActiveGroupRole('owner')
    setWorkspaceBusy(false)
    await Promise.all([
      loadAppData(createdGroup.id),
      loadProfile(),
      loadGroupMembers(createdGroup.id),
      loadUserPreferences(),
    ])
  }

  async function joinWorkspace() {
    if (!session) {
      return
    }

    const code = joinCode.trim().toUpperCase()

    if (!code) {
      setWorkspaceError('Введите код приглашения.')
      return
    }

    setWorkspaceBusy(true)
    setWorkspaceError('')

    const { data: groupId, error: joinError } = await supabase.rpc(
      'join_group_by_code',
      {
        code,
      }
    )

    if (joinError) {
      console.error('Ошибка присоединения по коду:', joinError)
      setWorkspaceError(
        'Не удалось присоединиться. Проверьте код приглашения.'
      )
      setWorkspaceBusy(false)
      return
    }

    if (!groupId) {
      setWorkspaceError('Группа по этому коду не найдена.')
      setWorkspaceBusy(false)
      return
    }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single()

    if (groupError) {
      console.error('Ошибка открытия присоединённой группы:', groupError)
      setWorkspaceError(
        'Вы присоединились, но пространство не удалось открыть.'
      )
      setWorkspaceBusy(false)
      return
    }

    const joinedGroup: Group = {
      id: String(group.id),
      name: group.name ?? 'Наши планы',
      created_by: String(group.created_by),
      invite_code: String(group.invite_code ?? ''),
      created_at: group.created_at ?? undefined,
    }

    setActiveGroup(joinedGroup)
    setJoinCode('')
    setWorkspaceBusy(false)
    await Promise.all([
      loadAppData(joinedGroup.id),
      loadProfile(),
      loadGroupMembers(joinedGroup.id),
      loadUserPreferences(),
    ])
  }

  async function loadProfile() {
    if (!session) {
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, created_at')
      .eq('id', session.user.id)
      .maybeSingle()

    if (error) {
      console.error('Ошибка загрузки профиля:', error)
      setProfileError('Не удалось загрузить профиль.')
      return
    }

    const loadedProfile: Profile = {
      id: session.user.id,
      email: data?.email ?? session.user.email ?? '',
      display_name: data?.display_name?.trim() ?? '',
      created_at: data?.created_at ?? undefined,
    }

    setProfile(loadedProfile)
    setProfileName(loadedProfile.display_name)
    setProfileError('')
  }

  async function loadGroupMembers(groupId: string) {
    setPeopleLoading(true)
    setPeopleError('')

    const { data, error } = await supabase.rpc('get_group_members_with_profiles', {
      requested_group_id: groupId,
    })

    if (error) {
      console.error('Ошибка загрузки участников:', error)
      setPeopleError('Не удалось загрузить участников группы.')
      setPeopleLoading(false)
      return
    }

    setGroupMembers(
      (data ?? []).map((member: {
        user_id: unknown
        email: unknown
        display_name: unknown
        role: unknown
        joined_at: unknown
      }) => ({
        user_id: String(member.user_id),
        email: String(member.email ?? ''),
        display_name: String(member.display_name ?? ''),
        role: String(member.role ?? 'member'),
        joined_at: member.joined_at ? String(member.joined_at) : undefined,
      }))
    )
    const currentMember = (data ?? []).find(
      (member: { user_id: unknown }) => String(member.user_id) === session?.user.id
    ) as { role?: unknown } | undefined

    if (currentMember) {
      setActiveGroupRole(String(currentMember.role ?? 'member'))
    }
    setPeopleLoading(false)
  }

  function startEditingGroupName() {
    if (!activeGroup || activeGroupRole !== 'owner') {
      return
    }

    setGroupNameDraft(activeGroup.name)
    setGroupNameError('')
    setEditingGroupName(true)
  }

  function cancelEditingGroupName() {
    if (groupNameBusy) {
      return
    }

    setGroupNameDraft('')
    setGroupNameError('')
    setEditingGroupName(false)
  }

  async function saveGroupName() {
    if (!activeGroup || !session || activeGroupRole !== 'owner') {
      return
    }

    const name = groupNameDraft.trim()

    if (!name) {
      setGroupNameError('Название группы не может быть пустым.')
      return
    }

    setGroupNameBusy(true)
    setGroupNameError('')

    const { data, error } = await supabase
      .from('groups')
      .update({ name })
      .eq('id', activeGroup.id)
      .eq('created_by', session.user.id)
      .select('name')
      .single()

    if (error) {
      console.error('Ошибка изменения названия группы:', error)
      setGroupNameError('Не удалось изменить название группы. Попробуйте ещё раз.')
      setGroupNameBusy(false)
      return
    }

    const savedName = data.name?.trim() || name
    setActiveGroup((group) => (group ? { ...group, name: savedName } : group))
    setGroupNameDraft('')
    setEditingGroupName(false)
    setGroupNameBusy(false)
  }

  async function getEdgeFunctionErrorMessage(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'context' in error &&
      error.context instanceof Response
    ) {
      try {
        const body = await error.context.clone().json() as { error?: string }
        if (body.error) {
          return body.error
        }
      } catch {
        // Fall back to the SDK error message below.
      }
    }

    return error instanceof Error ? error.message : 'Неизвестная ошибка.'
  }

  async function searchDiscoveryEvents() {
    const nowMilliseconds = Date.now()
    const actualSince = Math.floor(nowMilliseconds / 1000)
    const dayMilliseconds = 24 * 60 * 60 * 1000
    const moscowOffsetMilliseconds = 3 * 60 * 60 * 1000
    const actualUntil = discoveryPeriod === 1
      ? Math.floor(
          ((Math.floor(
            (nowMilliseconds + moscowOffsetMilliseconds) / dayMilliseconds
          ) + 1) * dayMilliseconds - moscowOffsetMilliseconds) / 1000
        )
      : actualSince + discoveryPeriod * 24 * 60 * 60

    setDiscoveryLoading(true)
    setDiscoverySearched(true)
    setDiscoveryError('')
    setDiscoveryFeedbackError('')
    setDiscoveryPlanMessage('')
    setDiscoveryPlanError('')

    const { data, error } = await supabase.functions.invoke('event-discovery', {
      body: {
        action: 'search_events',
        location: discoveryLocation,
        actual_since: actualSince,
        actual_until: actualUntil,
        page_size: 30,
      },
    })

    if (error) {
      setDiscoveryEvents([])
      setDiscoveryError(await getEdgeFunctionErrorMessage(error))
      setDiscoveryLoading(false)
      return
    }

    const events = Array.isArray(data?.events)
      ? data.events as DiscoveryEvent[]
      : []
    setDiscoveryEvents(events)
    await loadDiscoveryFeedback(events)
    setDiscoveryLoading(false)
  }

  async function loadDiscoveryFeedback(events: DiscoveryEvent[]) {
    if (!session || events.length === 0) {
      setDiscoveryFeedback({})
      return
    }

    const eventIds = [...new Set(events.map((event) => event.catalog_id))]
    const { data, error } = await supabase
      .from('event_feedback')
      .select('event_id, reaction')
      .eq('user_id', session.user.id)
      .in('event_id', eventIds)

    if (error) {
      console.error('Ошибка загрузки реакций на мероприятия:', error)
      setDiscoveryFeedback({})
      setDiscoveryFeedbackError('Не удалось загрузить сохранённые реакции.')
      return
    }

    const feedback: Record<string, EventReaction> = {}

    for (const row of data ?? []) {
      if (
        row.reaction === 'interested' ||
        row.reaction === 'not_interested' ||
        row.reaction === 'wishlist'
      ) {
        feedback[String(row.event_id)] = row.reaction
      }
    }

    setDiscoveryFeedback(feedback)
  }

  async function loadPersonalizedRecommendations(offset: number) {
    if (!session || recommendationsLoading) return

    setRecommendationsLoading(true)
    setRecommendationsSearched(true)
    setRecommendationsError('')
    setDiscoveryFeedbackError('')
    setDiscoveryPlanError('')
    setDiscoveryPlanMessage('')

    const { data, error } = await supabase.functions.invoke('event-discovery', {
      body: {
        action: 'personalized_recommendations',
        limit: 10,
        offset,
      },
    })

    if (error) {
      setRecommendations([])
      setRecommendationsError(await getEdgeFunctionErrorMessage(error))
      setRecommendationsLoading(false)
      return
    }

    if (data?.onboarding_required) {
      setRecommendations([])
      setRecommendationsLoading(false)
      return
    }

    const events = Array.isArray(data?.recommendations)
      ? data.recommendations as RecommendationEvent[]
      : []
    setRecommendations(events)
    setRecommendationsFeedbackCount(Number(data?.feedback_count) || 0)
    setRecommendationsOffset(offset + 10)
    setDiscoveryFeedback((current) => {
      const next = { ...current }
      for (const event of events) {
        if (
          event.reaction === 'interested' ||
          event.reaction === 'not_interested' ||
          event.reaction === 'wishlist'
        ) {
          next[event.catalog_id] = event.reaction
        } else {
          delete next[event.catalog_id]
        }
      }
      return next
    })
    setRecommendationsLoading(false)
  }

  async function loadPersonalizedPlaces(offset: number) {
    if (!session || placeRecommendationsLoading) return

    setPlaceRecommendationsLoading(true)
    setPlaceRecommendationsSearched(true)
    setPlaceRecommendationsError('')
    setPlaceFeedbackError('')
    setPlacePlanError('')
    setPlacePlanMessage('')

    const { data, error } = await supabase.functions.invoke('place-discovery', {
      body: {
        action: 'personalized_places',
        limit: 8,
        offset,
      },
    })

    if (error) {
      setPlaceRecommendations([])
      setPlaceRecommendationsError(await getEdgeFunctionErrorMessage(error))
      setPlaceRecommendationsLoading(false)
      return
    }

    const foundPlaces = Array.isArray(data?.recommendations)
      ? data.recommendations as RecommendationPlace[]
      : []
    setPlaceRecommendations(foundPlaces)
    setPlaceRecommendationsFeedbackCount(Number(data?.feedback_count) || 0)
    setPlaceRecommendationsOffset(offset + 8)
    setPlaceFeedback((current) => {
      const next = { ...current }
      for (const place of foundPlaces) {
        if (
          place.reaction === 'interested' ||
          place.reaction === 'not_interested' ||
          place.reaction === 'wishlist'
        ) {
          next[place.catalog_id] = place.reaction
        } else {
          delete next[place.catalog_id]
        }
      }
      return next
    })
    setPlaceRecommendationsLoading(false)
  }

  function loadAllRecommendations() {
    void loadPersonalizedRecommendations(recommendationsOffset)
    void loadPersonalizedPlaces(placeRecommendationsOffset)
  }

  async function searchPlaces() {
    if (!session || placesLoading) return

    const effectiveCity = placeCity || userPreferences?.city || ''
    if (!effectiveCity) {
      setPlacesError('Выберите город для поиска мест.')
      return
    }

    setPlacesLoading(true)
    setPlacesSearched(true)
    setPlacesError('')
    setPlaceFeedbackError('')
    setPlacePlanMessage('')
    setPlacePlanError('')
    const { data, error } = await supabase.functions.invoke('place-discovery', {
      body: {
        action: 'search_places',
        kind: placeKind,
        city: placeCity || undefined,
        limit: 20,
      },
    })

    if (error) {
      setPlaces([])
      setPlacesError(await getEdgeFunctionErrorMessage(error))
      setPlacesLoading(false)
      return
    }

    const foundPlaces = Array.isArray(data?.places)
      ? data.places as DiscoveredPlace[]
      : []
    setPlaces(foundPlaces)
    await loadPlaceFeedback(foundPlaces)
    setPlacesLoading(false)
  }

  async function loadPlaceFeedback(foundPlaces: DiscoveredPlace[]) {
    if (!session) return

    const placeIds = [...new Set(
      foundPlaces
        .map((place) => place.catalog_id)
        .filter((placeId): placeId is string => Boolean(placeId))
    )]

    if (placeIds.length === 0) {
      setPlaceFeedback({})
      return
    }

    const { data, error } = await supabase
      .from('place_feedback')
      .select('place_id, reaction')
      .eq('user_id', session.user.id)
      .in('place_id', placeIds)

    if (error) {
      console.error('Ошибка загрузки реакций на места:', error)
      setPlaceFeedback({})
      setPlaceFeedbackError('Не удалось загрузить сохранённые реакции на места.')
      return
    }

    const feedback: Record<string, PlaceReaction> = {}
    for (const row of data ?? []) {
      if (
        row.reaction === 'interested' ||
        row.reaction === 'not_interested' ||
        row.reaction === 'wishlist'
      ) {
        feedback[String(row.place_id)] = row.reaction
      }
    }
    setPlaceFeedback(feedback)
  }

  async function togglePlaceReaction(placeId: string, reaction: PlaceReaction) {
    if (!session || placeFeedbackBusy) return

    setPlaceFeedbackBusy(placeId)
    setPlaceFeedbackError('')
    const currentReaction = placeFeedback[placeId]

    if (currentReaction === reaction) {
      setPlaceFeedback((current) => {
        const next = { ...current }
        delete next[placeId]
        return next
      })

      const { error } = await supabase
        .from('place_feedback')
        .delete()
        .eq('user_id', session.user.id)
        .eq('place_id', placeId)

      if (error) {
        console.error('Ошибка удаления реакции на место:', error)
        setPlaceFeedbackError('Не удалось снять реакцию.')
        setPlaceFeedback((current) => ({ ...current, [placeId]: currentReaction }))
      }
      setPlaceFeedbackBusy('')
      return
    }

    setPlaceFeedback((current) => ({ ...current, [placeId]: reaction }))
    const { error } = await supabase
      .from('place_feedback')
      .upsert(
        { user_id: session.user.id, place_id: placeId, reaction },
        { onConflict: 'user_id,place_id' }
      )

    if (error) {
      console.error('Ошибка сохранения реакции на место:', error)
      setPlaceFeedbackError('Не удалось сохранить реакцию.')
      setPlaceFeedback((current) => {
        const next = { ...current }
        if (currentReaction) next[placeId] = currentReaction
        else delete next[placeId]
        return next
      })
    }
    setPlaceFeedbackBusy('')
  }

  async function addPlaceToPlans(place: DiscoveredPlace) {
    if (!session || !activeGroup || !place.catalog_id || placePlanBusy) return

    setPlacePlanBusy(place.catalog_id)
    setPlacePlanMessage('')
    setPlacePlanError('')

    const { data: existingPlan, error: checkError } = await supabase
      .from('plans')
      .select('id')
      .eq('group_id', activeGroup.id)
      .eq('place_catalog_id', place.catalog_id)
      .maybeSingle()

    if (checkError) {
      console.error('Ошибка проверки места в планах:', checkError)
      setPlacePlanError('Не удалось проверить список планов.')
      setPlacePlanBusy('')
      return
    }

    if (existingPlan) {
      await loadAppData(activeGroup.id)
      setPlacePlanError('Это место уже добавлено в планы.')
      setPlacePlanBusy('')
      return
    }

    const kindLabels: Record<PlaceKind, string> = {
      restaurant: 'Ресторан',
      cafe: 'Кафе',
      bar: 'Бар',
    }
    const tags = [...new Set([...place.cuisine, ...place.categories])]
    const noteParts: string[] = []
    if (place.cuisine.length > 0) noteParts.push(`Кухня: ${place.cuisine.join(', ')}`)
    if (place.categories.length > 0) {
      noteParts.push(`Категории: ${place.categories.join(', ')}`)
    }

    const { data, error } = await supabase
      .from('plans')
      .insert({
        place_catalog_id: place.catalog_id,
        title: place.name,
        type: kindLabels[place.kind],
        price: '',
        address: place.address ?? '',
        link: place.source_url || place.website || '',
        note: noteParts.join('. '),
        tags,
        created_by: session.user.id,
        group_id: activeGroup.id,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        await loadAppData(activeGroup.id)
        setPlacePlanError('Это место уже добавлено в планы.')
      } else {
        console.error('Ошибка добавления места в планы:', error)
        setPlacePlanError('Не удалось добавить место в планы.')
      }
      setPlacePlanBusy('')
      return
    }

    const addedPlan: Plan = {
      id: String(data.id),
      event_catalog_id: data.event_catalog_id ? String(data.event_catalog_id) : null,
      place_catalog_id: String(data.place_catalog_id),
      title: data.title ?? '',
      type: data.type ?? 'Другое',
      price: data.price ?? '',
      address: data.address ?? '',
      link: data.link ?? '',
      note: data.note ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      created_at: data.created_at ?? undefined,
    }
    setPlans((current) => [addedPlan, ...current])
    setPlacePlanMessage('Добавлено в Мои планы.')
    setPlacePlanBusy('')
  }

  function navigateTo(view: AppView) {
    setActiveView(view)

    if (
      view === 'recommendations' &&
      userPreferences?.onboarding_completed &&
      !recommendationsSearched &&
      !recommendationsLoading
    ) {
      void loadPersonalizedRecommendations(0)
      void loadPersonalizedPlaces(0)
    }
  }

  async function toggleDiscoveryReaction(
    eventId: string,
    reaction: EventReaction
  ) {
    if (!session || discoveryFeedbackBusy) {
      return
    }

    setDiscoveryFeedbackBusy(eventId)
    setDiscoveryFeedbackError('')
    const currentReaction = discoveryFeedback[eventId]

    if (currentReaction === reaction) {
      setDiscoveryFeedback((current) => {
        const next = { ...current }
        delete next[eventId]
        return next
      })

      const { error } = await supabase
        .from('event_feedback')
        .delete()
        .eq('user_id', session.user.id)
        .eq('event_id', eventId)

      if (error) {
        console.error('Ошибка удаления реакции:', error)
        setDiscoveryFeedbackError('Не удалось снять реакцию.')
        setDiscoveryFeedback((current) => ({
          ...current,
          [eventId]: currentReaction,
        }))
        setDiscoveryFeedbackBusy('')
        return
      }

      setDiscoveryFeedbackBusy('')
      return
    }

    setDiscoveryFeedback((current) => ({
      ...current,
      [eventId]: reaction,
    }))

    const { error } = await supabase
      .from('event_feedback')
      .upsert(
        {
          user_id: session.user.id,
          event_id: eventId,
          reaction,
        },
        { onConflict: 'user_id,event_id' }
      )

    if (error) {
      console.error('Ошибка сохранения реакции:', error)
      setDiscoveryFeedbackError('Не удалось сохранить реакцию.')
      setDiscoveryFeedback((current) => {
        const next = { ...current }
        if (currentReaction) {
          next[eventId] = currentReaction
        } else {
          delete next[eventId]
        }
        return next
      })
      setDiscoveryFeedbackBusy('')
      return
    }

    setDiscoveryFeedbackBusy('')
  }

  async function addDiscoveryEventToPlans(event: DiscoveryEvent) {
    if (!session || !activeGroup || discoveryPlanBusy) {
      return
    }

    setDiscoveryPlanBusy(event.catalog_id)
    setDiscoveryPlanMessage('')
    setDiscoveryPlanError('')

    const { data: existingPlan, error: checkError } = await supabase
      .from('plans')
      .select('id')
      .eq('group_id', activeGroup.id)
      .eq('event_catalog_id', event.catalog_id)
      .maybeSingle()

    if (checkError) {
      console.error('Ошибка проверки мероприятия в планах:', checkError)
      setDiscoveryPlanError('Не удалось проверить список планов.')
      setDiscoveryPlanBusy('')
      return
    }

    if (existingPlan) {
      await loadAppData(activeGroup.id)
      setDiscoveryPlanError('Это мероприятие уже добавлено в планы.')
      setDiscoveryPlanBusy('')
      return
    }

    const normalizedDescription = event.description
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
    const { data, error } = await supabase
      .from('plans')
      .insert({
        event_catalog_id: event.catalog_id,
        title: event.title,
        type: event.categories[0] || 'Другое',
        price: event.price,
        address: event.address,
        link: event.source_url,
        note: normalizedDescription,
        tags: event.categories,
        created_by: session.user.id,
        group_id: activeGroup.id,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        await loadAppData(activeGroup.id)
        setDiscoveryPlanError('Это мероприятие уже добавлено в планы.')
      } else {
        console.error('Ошибка добавления мероприятия в планы:', error)
        setDiscoveryPlanError('Не удалось добавить мероприятие в планы.')
      }

      setDiscoveryPlanBusy('')
      return
    }

    const addedPlan: Plan = {
      id: String(data.id),
      event_catalog_id: String(data.event_catalog_id),
      title: data.title ?? '',
      type: data.type ?? 'Другое',
      price: data.price ?? '',
      address: data.address ?? '',
      link: data.link ?? '',
      note: data.note ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      created_at: data.created_at ?? undefined,
    }

    setPlans((currentPlans) => [addedPlan, ...currentPlans])
    setDiscoveryPlanMessage('Добавлено в Мои планы.')
    setDiscoveryPlanBusy('')
  }

  async function loadUserPreferences() {
    if (!session) return

    setPreferencesLoading(true)
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      console.error('Ошибка загрузки предпочтений:', error)
      setPreferencesError('Не удалось загрузить профиль вкусов.')
      setPreferencesLoading(false)
      return
    }

    const preferences: UserPreferences = data
      ? {
          user_id: String(data.user_id),
          preference_text: data.preference_text ?? '',
          city: data.city ?? 'msk',
          onboarding_completed: data.onboarding_completed === true,
          calibration_completed_at: data.calibration_completed_at ?? null,
        }
      : {
          user_id: session.user.id,
          preference_text: '',
          city: 'msk',
          onboarding_completed: false,
          calibration_completed_at: null,
        }

    setUserPreferences(preferences)
    setPreferenceTextDraft(preferences.preference_text)
    setPreferenceCityDraft(preferences.city)
    setPreferencesError('')
    setPreferencesLoading(false)

    if (!preferences.onboarding_completed) {
      setOnboardingStep('preferences')
    }
  }

  async function saveUserPreferences(beginCalibration: boolean) {
    if (!session) return

    const preferenceText = preferenceTextDraft.trim()

    if (!preferenceText) {
      setPreferencesError('Расскажите хотя бы немного о своих предпочтениях.')
      return
    }

    setPreferencesBusy(true)
    setPreferencesError('')
    setPreferencesMessage('')
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: session.user.id,
          preference_text: preferenceText,
          city: preferenceCityDraft,
          onboarding_completed: userPreferences?.onboarding_completed ?? false,
          calibration_completed_at:
            userPreferences?.calibration_completed_at ?? null,
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single()

    if (error) {
      console.error('Ошибка сохранения предпочтений:', error)
      setPreferencesError('Не удалось сохранить предпочтения.')
      setPreferencesBusy(false)
      return
    }

    const saved: UserPreferences = {
      user_id: String(data.user_id),
      preference_text: data.preference_text ?? '',
      city: data.city ?? 'msk',
      onboarding_completed: data.onboarding_completed === true,
      calibration_completed_at: data.calibration_completed_at ?? null,
    }
    setUserPreferences(saved)
    setPreferenceTextDraft(saved.preference_text)
    setPreferenceCityDraft(saved.city)
    setPreferencesEditing(false)
    setPreferencesBusy(false)

    if (beginCalibration) {
      await startCalibration(saved.city)
    } else {
      setPreferencesMessage('Предпочтения сохранены.')
    }
  }

  function diversifyCalibrationEvents(events: DiscoveryEvent[]) {
    const buckets = new Map<string, DiscoveryEvent[]>()

    for (const event of events) {
      const category = event.categories[0] || 'other'
      buckets.set(category, [...(buckets.get(category) ?? []), event])
    }

    const selected: DiscoveryEvent[] = []
    const bucketList = [...buckets.values()]

    while (selected.length < 10 && bucketList.some((bucket) => bucket.length)) {
      for (const bucket of bucketList) {
        const event = bucket.shift()
        if (event) selected.push(event)
        if (selected.length === 10) break
      }
    }

    return selected
  }

  async function startCalibration(
    city = userPreferences?.city || 'msk',
    includePreviouslyRated = false
  ) {
    setOnboardingStep('calibration')
    setCalibrationLoading(true)
    setCalibrationError('')
    setCalibrationEvents([])
    setCalibrationIndex(0)
    const actualSince = Math.floor(Date.now() / 1000)
    const { data, error } = await supabase.functions.invoke('event-discovery', {
      body: {
        action: 'search_events',
        location: city,
        actual_since: actualSince,
        actual_until: actualSince + 30 * 24 * 60 * 60,
        page_size: 60,
      },
    })

    if (error) {
      setCalibrationError(await getEdgeFunctionErrorMessage(error))
      setCalibrationLoading(false)
      return
    }

    let events = Array.isArray(data?.events)
      ? data.events as DiscoveryEvent[]
      : []

    if (!includePreviouslyRated && session && events.length > 0) {
      const eventIds = [...new Set(events.map((event) => event.catalog_id))]
      const { data: existingFeedback, error: feedbackError } = await supabase
        .from('event_feedback')
        .select('event_id')
        .eq('user_id', session.user.id)
        .in('event_id', eventIds)

      if (feedbackError) {
        console.error('Ошибка проверки предыдущих реакций:', feedbackError)
        setCalibrationError(
          'Не удалось проверить предыдущие ответы. Попробуйте ещё раз.'
        )
        setCalibrationLoading(false)
        return
      }

      const ratedEventIds = new Set(
        (existingFeedback ?? []).map((row) => String(row.event_id))
      )
      events = events.filter((event) => !ratedEventIds.has(event.catalog_id))
    }

    const diversified = diversifyCalibrationEvents(events)
    setCalibrationEvents(diversified)
    setCalibrationLoading(false)

    if (diversified.length === 0) {
      setCalibrationError('Не удалось найти мероприятия для калибровки.')
    }
  }

  async function answerCalibration(reaction?: Exclude<EventReaction, 'wishlist'>) {
    if (!session || calibrationBusy) return

    const event = calibrationEvents[calibrationIndex]
    if (!event) return

    setCalibrationBusy(true)
    setCalibrationError('')

    if (reaction) {
      const { error } = await supabase
        .from('event_feedback')
        .upsert(
          {
            user_id: session.user.id,
            event_id: event.catalog_id,
            reaction,
          },
          { onConflict: 'user_id,event_id' }
        )

      if (error) {
        console.error('Ошибка сохранения ответа калибровки:', error)
        setCalibrationError('Не удалось сохранить ответ.')
        setCalibrationBusy(false)
        return
      }

      setDiscoveryFeedback((current) => ({
        ...current,
        [event.catalog_id]: reaction,
      }))
    }

    if (calibrationIndex + 1 < calibrationEvents.length) {
      setCalibrationIndex((index) => index + 1)
      setCalibrationBusy(false)
      return
    }

    const completedAt = new Date().toISOString()
    const { error } = await supabase
      .from('user_preferences')
      .update({
        onboarding_completed: true,
        calibration_completed_at: completedAt,
      })
      .eq('user_id', session.user.id)

    if (error) {
      console.error('Ошибка завершения калибровки:', error)
      setCalibrationError('Не удалось завершить калибровку.')
      setCalibrationBusy(false)
      return
    }

    setUserPreferences((current) => current
      ? {
          ...current,
          onboarding_completed: true,
          calibration_completed_at: completedAt,
        }
      : current
    )
    setCalibrationBusy(false)
    setOnboardingStep('complete')
  }

  async function saveProfile() {
    if (!session) {
      return
    }

    const displayName = profileName.trim()

    setProfileBusy(true)
    setProfileError('')
    setProfileMessage('')

    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: session.user.id,
          email: session.user.email ?? profile?.email ?? '',
          display_name: displayName || null,
        },
        { onConflict: 'id' }
      )
      .select('id, email, display_name, created_at')
      .single()

    if (error) {
      console.error('Ошибка сохранения профиля:', error)
      setProfileError('Не удалось сохранить имя.')
      setProfileBusy(false)
      return
    }

    const savedProfile: Profile = {
      id: String(data.id),
      email: data.email ?? session.user.email ?? '',
      display_name: data.display_name?.trim() ?? '',
      created_at: data.created_at ?? undefined,
    }

    setProfile(savedProfile)
    setProfileName(savedProfile.display_name)
    setGroupMembers((members) =>
      members.map((member) =>
        member.user_id === savedProfile.id
          ? { ...member, display_name: savedProfile.display_name }
          : member
      )
    )
    setProfileMessage('Имя сохранено.')
    setProfileBusy(false)
  }

  async function copyInviteCode() {
    if (!activeGroup?.invite_code) {
      return
    }

    try {
      await navigator.clipboard.writeText(activeGroup.invite_code)
      setInviteCopied(true)

      window.setTimeout(() => {
        setInviteCopied(false)
      }, 1800)
    } catch (error) {
      console.error('Не удалось скопировать код:', error)
      window.prompt(
        'Скопируйте код приглашения:',
        activeGroup.invite_code
      )
    }
  }

  async function loadAppData(groupId: string) {
    setLoading(true)
    setErrorMessage('')

    const { data: plansData, error: plansError } = await supabase
      .from('plans')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })

    if (plansError) {
      console.error('Ошибка загрузки планов:', plansError)
      setErrorMessage('Не удалось загрузить планы из Supabase.')
      setLoading(false)
      return
    }

    const loadedPlans: Plan[] = (plansData ?? []).map((plan) => ({
      id: String(plan.id),
      event_catalog_id: plan.event_catalog_id
        ? String(plan.event_catalog_id)
        : null,
      place_catalog_id: plan.place_catalog_id
        ? String(plan.place_catalog_id)
        : null,
      title: plan.title ?? '',
      type: plan.type ?? 'Другое',
      price: plan.price ?? 'Цена не указана',
      address: plan.address ?? '',
      link: plan.link ?? '',
      note: plan.note ?? '',
      tags: Array.isArray(plan.tags) ? plan.tags : [],
      created_at: plan.created_at ?? undefined,
    }))

    const planIds = loadedPlans.map((plan) => plan.id)

    if (planIds.length === 0) {
      setPlans([])
      setPlanEvents([])
      setPlanDesires([])
      setEventRatings([])
      setPlanDesireSummaries([])
      setEventRatingSummaries([])
      setLoading(false)
      return
    }

    const [eventsResult, desiresResult, desireSummariesResult] = await Promise.all([
      supabase
        .from('plan_events')
        .select('*')
        .in('plan_id', planIds)
        .order('planned_at', { ascending: true }),
      supabase
        .from('plan_desires')
        .select('*')
        .in('plan_id', planIds),
      supabase.rpc('get_group_plan_desire_summaries', {
        requested_group_id: groupId,
      }),
    ])

    if (eventsResult.error) {
      console.error('Ошибка загрузки событий:', eventsResult.error)
      setErrorMessage('Не удалось загрузить события.')
      setLoading(false)
      return
    }

    if (desiresResult.error) {
      console.error('Ошибка загрузки желаемого:', desiresResult.error)
      setErrorMessage('Не удалось загрузить оценки «Желаемое».')
      setLoading(false)
      return
    }

    if (desireSummariesResult.error) {
      console.error('Ошибка загрузки среднего желаемого:', desireSummariesResult.error)
      setErrorMessage('Не удалось загрузить средние оценки «Желаемое».')
      setLoading(false)
      return
    }

    const loadedEvents: PlanEvent[] = (eventsResult.data ?? []).map((event) => ({
      id: String(event.id),
      plan_id: String(event.plan_id),
      planned_at: event.planned_at,
      comment: event.comment ?? '',
      status: event.status ?? 'planned',
      created_at: event.created_at ?? undefined,
    }))

    const loadedDesires: PlanDesire[] = (desiresResult.data ?? []).map(
      (desire) => ({
        id: String(desire.id),
        plan_id: String(desire.plan_id),
        user_id: String(desire.user_id),
        score: Number(desire.score),
        comment: desire.comment ?? '',
        created_at: desire.created_at ?? undefined,
        updated_at: desire.updated_at ?? undefined,
      })
    )

    const eventIds = loadedEvents.map((event) => event.id)
    let loadedRatings: EventRating[] = []

    const { data: ratingSummariesData, error: ratingSummariesError } =
      await supabase.rpc('get_group_event_rating_summaries', {
        requested_group_id: groupId,
      })

    if (ratingSummariesError) {
      console.error('Ошибка загрузки средних оценок по факту:', ratingSummariesError)
      setErrorMessage('Не удалось загрузить средние оценки по факту.')
      setLoading(false)
      return
    }

    if (eventIds.length > 0) {
      const { data: ratingsData, error: ratingsError } = await supabase
        .from('event_ratings')
        .select('*')
        .in('plan_event_id', eventIds)

      if (ratingsError) {
        console.error('Ошибка загрузки оценок по факту:', ratingsError)
        setErrorMessage('Не удалось загрузить оценки по факту.')
        setLoading(false)
        return
      }

      loadedRatings = (ratingsData ?? []).map((rating) => ({
        id: String(rating.id),
        plan_event_id: String(rating.plan_event_id),
        user_id: String(rating.user_id),
        score: Number(rating.score),
        comment: rating.comment ?? '',
        created_at: rating.created_at ?? undefined,
        updated_at: rating.updated_at ?? undefined,
      }))
    }

    setPlans(loadedPlans)
    setPlanEvents(loadedEvents)
    setPlanDesires(loadedDesires)
    setEventRatings(loadedRatings)
    setPlanDesireSummaries(
      (desireSummariesResult.data ?? []).map((summary: {
        plan_id: unknown
        average_score: unknown
        rating_count: unknown
      }) => ({
        entity_id: String(summary.plan_id),
        average: Number(summary.average_score),
        count: Number(summary.rating_count),
      }))
    )
    setEventRatingSummaries(
      (ratingSummariesData ?? []).map((summary: {
        plan_event_id: unknown
        average_score: unknown
        rating_count: unknown
      }) => ({
        entity_id: String(summary.plan_event_id),
        average: Number(summary.average_score),
        count: Number(summary.rating_count),
      }))
    )
    setLoading(false)
  }


  function chooseRandomPlan() {
    if (plans.length === 0) {
      return
    }

    const plan = plans[Math.floor(Math.random() * plans.length)]
    setSelectedPlan(plan)
  }

  function parseTags(value: string) {
    return value
      .split(/[·,;]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  async function addPlan() {
    if (!session || !activeGroup) {
      alert('Сначала откройте общее пространство')
      return
    }

    if (!newTitle.trim()) {
      alert('Введите название плана')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('plans')
      .insert({
        title: newTitle.trim(),
        type: newType.trim() || 'Другое',
        price: newPrice.trim() || 'Цена не указана',
        address: newAddress.trim(),
        link: newLink.trim(),
        note: newNote.trim(),
        tags: parseTags(newTags),
        group_id: activeGroup.id,
        created_by: session.user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Ошибка добавления плана:', error)
      setErrorMessage('Не удалось сохранить новый план.')
      setSaving(false)
      return
    }

    const addedPlan: Plan = {
      id: String(data.id),
      event_catalog_id: data.event_catalog_id
        ? String(data.event_catalog_id)
        : null,
      place_catalog_id: data.place_catalog_id
        ? String(data.place_catalog_id)
        : null,
      title: data.title ?? '',
      type: data.type ?? 'Другое',
      price: data.price ?? 'Цена не указана',
      address: data.address ?? '',
      link: data.link ?? '',
      note: data.note ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      created_at: data.created_at ?? undefined,
    }

    setPlans((currentPlans) => [addedPlan, ...currentPlans])

    setNewTitle('')
    setNewType('')
    setNewPrice('')
    setNewAddress('')
    setNewLink('')
    setNewNote('')
    setNewTags('')

    setShowAddForm(false)
    setSaving(false)
  }

  function startEditing(plan: Plan) {
    setEditingPlan(plan)

    setEditTitle(plan.title)
    setEditType(plan.type)
    setEditPrice(plan.price)
    setEditAddress(plan.address)
    setEditLink(plan.link)
    setEditNote(plan.note)
    setEditTags(plan.tags.join(' · '))

    setSelectedPlan(null)
  }

  function cancelEditing() {
    setEditingPlan(null)
  }

  async function saveEditedPlan() {
    if (!editingPlan) {
      return
    }

    if (!editTitle.trim()) {
      alert('Введите название плана')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('plans')
      .update({
        title: editTitle.trim(),
        type: editType.trim() || 'Другое',
        price: editPrice.trim() || 'Цена не указана',
        address: editAddress.trim(),
        link: editLink.trim(),
        note: editNote.trim(),
        tags: parseTags(editTags),
      })
      .eq('id', editingPlan.id)
      .select()
      .single()

    if (error) {
      console.error('Ошибка редактирования плана:', error)
      setErrorMessage('Не удалось сохранить изменения.')
      setSaving(false)
      return
    }

    const updatedPlan: Plan = {
      id: String(data.id),
      event_catalog_id: data.event_catalog_id
        ? String(data.event_catalog_id)
        : editingPlan.event_catalog_id ?? null,
      place_catalog_id: data.place_catalog_id
        ? String(data.place_catalog_id)
        : editingPlan.place_catalog_id ?? null,
      title: data.title ?? '',
      type: data.type ?? 'Другое',
      price: data.price ?? 'Цена не указана',
      address: data.address ?? '',
      link: data.link ?? '',
      note: data.note ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      created_at: data.created_at ?? undefined,
    }

    setPlans((currentPlans) =>
      currentPlans.map((plan) =>
        plan.id === updatedPlan.id ? updatedPlan : plan
      )
    )

    setEditingPlan(null)
    setSelectedPlan(updatedPlan)
    setSaving(false)
  }


  function openScheduleForm(plan: Plan) {
    setSchedulingPlan(plan)
    setSelectedPlan(null)
    setScheduleDate('')
    setScheduleTime('')
    setScheduleComment('')
  }

  function closeScheduleForm() {
    if (saving) {
      return
    }

    setSchedulingPlan(null)
    setScheduleDate('')
    setScheduleTime('')
    setScheduleComment('')
  }

  async function savePlanEvent() {
    if (!schedulingPlan) {
      return
    }

    if (!scheduleDate) {
      alert('Выберите дату')
      return
    }

    if (!scheduleTime) {
      alert('Выберите время')
      return
    }

    const localDateTime = new Date(`${scheduleDate}T${scheduleTime}:00`)

    if (Number.isNaN(localDateTime.getTime())) {
      alert('Не удалось определить дату и время')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('plan_events')
      .insert({
        plan_id: schedulingPlan.id,
        planned_at: localDateTime.toISOString(),
        comment: scheduleComment.trim(),
        status: 'planned',
      })
      .select()
      .single()

    if (error) {
      console.error('Ошибка планирования:', error)
      setErrorMessage('Не удалось сохранить дату и время.')
      setSaving(false)
      return
    }

    const addedEvent: PlanEvent = {
      id: String(data.id),
      plan_id: String(data.plan_id),
      planned_at: data.planned_at,
      comment: data.comment ?? '',
      status: data.status ?? 'planned',
      created_at: data.created_at ?? undefined,
    }

    setPlanEvents((currentEvents) => [...currentEvents, addedEvent])
    setSchedulingPlan(null)
    setScheduleDate('')
    setScheduleTime('')
    setScheduleComment('')
    setSaving(false)
  }

  function openCalendarEventEditor(event: PlanEvent) {
    const plannedAt = new Date(event.planned_at)
    setEditingCalendarEvent(event)
    setCalendarEditDate(localDateKey(plannedAt))
    setCalendarEditTime(localTimeValue(plannedAt))
    setCalendarEditComment(event.comment)
    setCalendarError('')
  }

  function closeCalendarEventEditor() {
    if (calendarEventBusy) return
    setEditingCalendarEvent(null)
    setCalendarError('')
  }

  async function saveCalendarEvent() {
    if (!editingCalendarEvent || !calendarEditDate || !calendarEditTime) return
    const localDateTime = new Date(`${calendarEditDate}T${calendarEditTime}:00`)
    if (Number.isNaN(localDateTime.getTime())) {
      setCalendarError('Не удалось определить дату и время.')
      return
    }

    setCalendarEventBusy(true)
    setCalendarError('')
    const { data, error } = await supabase
      .from('plan_events')
      .update({
        planned_at: localDateTime.toISOString(),
        comment: calendarEditComment.trim(),
      })
      .eq('id', editingCalendarEvent.id)
      .eq('plan_id', editingCalendarEvent.plan_id)
      .select()
      .single()

    if (error) {
      console.error('Ошибка изменения похода:', error)
      setCalendarError('Не удалось изменить поход. Проверьте права доступа и попробуйте ещё раз.')
      setCalendarEventBusy(false)
      return
    }

    const updatedEvent: PlanEvent = {
      id: String(data.id),
      plan_id: String(data.plan_id),
      planned_at: data.planned_at,
      comment: data.comment ?? '',
      status: data.status ?? editingCalendarEvent.status,
      created_at: data.created_at ?? editingCalendarEvent.created_at,
    }
    setPlanEvents((events) => events
      .map((event) => event.id === updatedEvent.id ? updatedEvent : event)
      .sort((a, b) => Date.parse(a.planned_at) - Date.parse(b.planned_at)))
    setSelectedCalendarDate(localDateKey(new Date(updatedEvent.planned_at)))
    setCalendarMonth(new Date(
      new Date(updatedEvent.planned_at).getFullYear(),
      new Date(updatedEvent.planned_at).getMonth(),
      1
    ))
    setEditingCalendarEvent(null)
    setCalendarEventBusy(false)
  }

  async function cancelCalendarEvent() {
    if (!editingCalendarEvent || calendarEventBusy) return
    const confirmed = window.confirm('Отменить этот поход? Сам план останется в «Моих планах».')
    if (!confirmed) return

    setCalendarEventBusy(true)
    setCalendarError('')
    const { error } = await supabase
      .from('plan_events')
      .delete()
      .eq('id', editingCalendarEvent.id)
      .eq('plan_id', editingCalendarEvent.plan_id)

    if (error) {
      console.error('Ошибка отмены похода:', error)
      setCalendarError('Не удалось отменить поход. Проверьте права доступа и попробуйте ещё раз.')
      setCalendarEventBusy(false)
      return
    }

    const removedId = editingCalendarEvent.id
    setPlanEvents((events) => events.filter((event) => event.id !== removedId))
    setEventRatings((ratings) => ratings.filter((rating) => rating.plan_event_id !== removedId))
    setEventRatingSummaries((summaries) =>
      summaries.filter((summary) => summary.entity_id !== removedId)
    )
    setEditingCalendarEvent(null)
    setCalendarEventBusy(false)
  }

  function openPlanFromCalendar(plan: Plan) {
    setActiveView('home')
    setSelectedPlan(plan)
  }

  function formatPlannedAt(value: string) {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }


  function getMyPlanDesire(planId: string) {
    return planDesires.find(
      (desire) =>
        desire.plan_id === planId && desire.user_id === session?.user.id
    )
  }

  function getPlanDesireSummary(planId: string) {
    return (
      planDesireSummaries.find((summary) => summary.entity_id === planId) ?? {
        entity_id: planId,
        average: 0,
        count: 0,
      }
    )
  }

  function hasOtherPlanDesires(planId: string) {
    const myRatingCount = getMyPlanDesire(planId) ? 1 : 0
    return getPlanDesireSummary(planId).count > myRatingCount
  }

  function openDesireForm(plan: Plan) {
    const currentDesire = getMyPlanDesire(plan.id)

    setDesirePlan(plan)
    setSelectedPlan(null)
    setDesireScore(currentDesire ? String(currentDesire.score) : '')
    setDesireComment(currentDesire?.comment ?? '')
  }

  function closeDesireForm() {
    if (saving) {
      return
    }

    setDesirePlan(null)
    setDesireScore('')
    setDesireComment('')
  }

  async function saveDesire() {
    if (!desirePlan || !session || !activeGroup) {
      return
    }

    const score = Number(desireScore)

    if (!Number.isInteger(score) || score < 1 || score > 10) {
      alert('Выберите оценку от 1 до 10')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('plan_desires')
      .upsert(
        {
          plan_id: desirePlan.id,
          user_id: session.user.id,
          score,
          comment: desireComment.trim(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'plan_id,user_id',
        }
      )
      .select()
      .single()

    if (error) {
      console.error('Ошибка сохранения «Желаемого»:', error)
      setErrorMessage('Не удалось сохранить оценку «Желаемое».')
      setSaving(false)
      return
    }

    const savedDesire: PlanDesire = {
      id: String(data.id),
      plan_id: String(data.plan_id),
      user_id: String(data.user_id),
      score: Number(data.score),
      comment: data.comment ?? '',
      created_at: data.created_at ?? undefined,
      updated_at: data.updated_at ?? undefined,
    }

    setPlanDesires((currentDesires) => {
      const alreadyExists = currentDesires.some(
        (desire) =>
          desire.plan_id === savedDesire.plan_id &&
          desire.user_id === savedDesire.user_id
      )

      if (alreadyExists) {
        return currentDesires.map((desire) =>
          desire.plan_id === savedDesire.plan_id &&
          desire.user_id === savedDesire.user_id
            ? savedDesire
            : desire
        )
      }

      return [...currentDesires, savedDesire]
    })

    setDesirePlan(null)
    setDesireScore('')
    setDesireComment('')
    await loadAppData(activeGroup.id)
    setSaving(false)
  }

  function getMyEventRating(eventId: string) {
    return eventRatings.find(
      (rating) =>
        rating.plan_event_id === eventId && rating.user_id === session?.user.id
    )
  }

  function getEventRatingSummary(eventId: string) {
    return (
      eventRatingSummaries.find((summary) => summary.entity_id === eventId) ?? {
        entity_id: eventId,
        average: 0,
        count: 0,
      }
    )
  }

  function openFactRatingForm(event: PlanEvent) {
    const currentRating = getMyEventRating(event.id)

    setRatingEvent(event)
    setFactScore(currentRating ? String(currentRating.score) : '')
    setFactComment(currentRating?.comment ?? '')
  }

  function closeFactRatingForm() {
    if (saving) {
      return
    }

    setRatingEvent(null)
    setFactScore('')
    setFactComment('')
  }

  async function saveFactRating() {
    if (!ratingEvent || !session || !activeGroup) {
      return
    }

    if (new Date(ratingEvent.planned_at).getTime() >= Date.now()) {
      alert('Оценку по факту можно поставить только после запланированной даты.')
      return
    }

    const score = Number(factScore)

    if (!Number.isInteger(score) || score < 1 || score > 10) {
      alert('Выберите оценку от 1 до 10')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('event_ratings')
      .upsert(
        {
          plan_event_id: ratingEvent.id,
          user_id: session.user.id,
          score,
          comment: factComment.trim(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'plan_event_id,user_id',
        }
      )
      .select()
      .single()

    if (error) {
      console.error('Ошибка сохранения оценки по факту:', error)
      setErrorMessage('Не удалось сохранить оценку по факту.')
      setSaving(false)
      return
    }

    const savedRating: EventRating = {
      id: String(data.id),
      plan_event_id: String(data.plan_event_id),
      user_id: String(data.user_id),
      score: Number(data.score),
      comment: data.comment ?? '',
      created_at: data.created_at ?? undefined,
      updated_at: data.updated_at ?? undefined,
    }

    setEventRatings((currentRatings) => {
      const alreadyExists = currentRatings.some(
        (rating) =>
          rating.plan_event_id === savedRating.plan_event_id &&
          rating.user_id === savedRating.user_id
      )

      if (alreadyExists) {
        return currentRatings.map((rating) =>
          rating.plan_event_id === savedRating.plan_event_id &&
          rating.user_id === savedRating.user_id
            ? savedRating
            : rating
        )
      }

      return [...currentRatings, savedRating]
    })

    setRatingEvent(null)
    setFactScore('')
    setFactComment('')
    await loadAppData(activeGroup.id)
    setSaving(false)
  }

  async function deletePlan(plan: Plan) {
    const confirmed = window.confirm(
      `Удалить план «${plan.title}»? Это действие нельзя отменить.`
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setErrorMessage('')

    const { error } = await supabase
      .from('plans')
      .delete()
      .eq('id', plan.id)

    if (error) {
      console.error('Ошибка удаления плана:', error)
      setErrorMessage('Не удалось удалить план.')
      setDeleting(false)
      return
    }

    setPlans((currentPlans) =>
      currentPlans.filter((currentPlan) => currentPlan.id !== plan.id)
    )

    const removedEventIds = new Set(
      planEvents
        .filter((event) => event.plan_id === plan.id)
        .map((event) => event.id)
    )

    setPlanEvents((currentEvents) =>
      currentEvents.filter((event) => event.plan_id !== plan.id)
    )

    setPlanDesires((currentDesires) =>
      currentDesires.filter((desire) => desire.plan_id !== plan.id)
    )

    setEventRatings((currentRatings) =>
      currentRatings.filter(
        (rating) => !removedEventIds.has(rating.plan_event_id)
      )
    )

    setSelectedPlan(null)
    setDeleting(false)
  }

  const plannedEvents = planEvents
    .filter((event) => new Date(event.planned_at).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.planned_at).getTime() - new Date(b.planned_at).getTime()
    )

  const completedEvents = planEvents
    .filter((event) => new Date(event.planned_at).getTime() < now)
    .sort(
      (a, b) =>
        new Date(b.planned_at).getTime() - new Date(a.planned_at).getTime()
    )

  const desiredRanking = plans
    .map((plan) => ({
      plan,
      ...getPlanDesireSummary(plan.id),
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (b.average !== a.average) {
        return b.average - a.average
      }

      return b.count - a.count
    })

  const factRanking = plans
    .map((plan) => {
      const completedPlanEventIds = new Set(
        completedEvents
          .filter((event) => event.plan_id === plan.id)
          .map((event) => event.id)
      )

      const summaries = eventRatingSummaries.filter((summary) =>
        completedPlanEventIds.has(summary.entity_id)
      )

      const count = summaries.reduce((sum, summary) => sum + summary.count, 0)

      const average =
        count > 0
          ? summaries.reduce(
              (sum, summary) => sum + summary.average * summary.count,
              0
            ) / count
          : 0

      return {
        plan,
        average,
        count,
      }
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (b.average !== a.average) {
        return b.average - a.average
      }

      return b.count - a.count
    })

  function openPlanFromRanking(plan: Plan) {
    setActiveView('home')
    setSelectedPlan(plan)
  }

  const filteredPlans = plans.filter((plan) => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return true
    }

    return (
      plan.title.toLowerCase().includes(query) ||
      plan.type.toLowerCase().includes(query) ||
      plan.address.toLowerCase().includes(query) ||
      plan.note.toLowerCase().includes(query) ||
      plan.tags.join(' ').toLowerCase().includes(query)
    )
  })

  if (authLoading) {
    return (
      <div style={authPageStyle}>
        <div style={authCardStyle}>
          <h1 style={pageTitleStyle}>Планы</h1>

          <p
            style={{
              marginBottom: 0,
              color: '#777',
              lineHeight: 1.5,
            }}
          >
            Проверяю вход…
          </p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={authPageStyle}>
        <div style={authCardStyle}>
          <h1 style={pageTitleStyle}>Планы</h1>

          <p
            style={{
              marginTop: 0,
              marginBottom: 28,
              color: '#777',
              lineHeight: 1.55,
            }}
          >
            {authMode === 'login'
              ? 'Войдите, чтобы открыть свои планы.'
              : 'Создайте аккаунт для приложения.'}
          </p>

          <div style={authTabsStyle}>
            <button
              onClick={() => switchAuthMode('login')}
              style={{
                ...authTabButtonStyle,
                fontWeight: authMode === 'login' ? 700 : 400,
                background: authMode === 'login' ? '#f2f2f2' : 'transparent',
              }}
            >
              Войти
            </button>

            <button
              onClick={() => switchAuthMode('register')}
              style={{
                ...authTabButtonStyle,
                fontWeight: authMode === 'register' ? 700 : 400,
                background:
                  authMode === 'register' ? '#f2f2f2' : 'transparent',
              }}
            >
              Регистрация
            </button>
          </div>

          <label style={fieldLabelStyle}>Email</label>

          <input
            type="email"
            value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            style={inputStyle}
          />

          <label style={fieldLabelStyle}>Пароль</label>

          <input
            type="password"
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
            placeholder="Минимум 6 символов"
            autoComplete={
              authMode === 'login' ? 'current-password' : 'new-password'
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !authBusy) {
                void handleAuth()
              }
            }}
            style={inputStyle}
          />

          {authError && (
            <div style={authErrorStyle}>
              {authError}
            </div>
          )}

          {authMessage && (
            <div style={authSuccessStyle}>
              {authMessage}
            </div>
          )}

          <button
            onClick={() => void handleAuth()}
            disabled={authBusy}
            style={{
              ...mainButtonStyle,
              marginTop: 18,
              opacity: authBusy ? 0.6 : 1,
            }}
          >
            {authBusy
              ? 'Подождите…'
              : authMode === 'login'
                ? 'Войти'
                : 'Зарегистрироваться'}
          </button>

          <div
            style={{
              marginTop: 18,
              color: '#888',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Вход работает через Supabase Auth.
          </div>
        </div>
      </div>
    )
  }

  if (workspaceLoading) {
    return (
      <div style={authPageStyle}>
        <div style={authCardStyle}>
          <h1 style={pageTitleStyle}>Планы</h1>

          <p
            style={{
              marginBottom: 0,
              color: '#777',
              lineHeight: 1.5,
            }}
          >
            Загружаю общее пространство…
          </p>
        </div>
      </div>
    )
  }

  if (!activeGroup) {
    return (
      <div style={authPageStyle}>
        <div style={authCardStyle}>
          <div style={workspaceUserRowStyle}>
            <div
              style={{
                minWidth: 0,
                color: '#666',
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              👤 {session.user.email ?? 'Пользователь'}
            </div>

            <button
              onClick={() => void handleSignOut()}
              disabled={authBusy || workspaceBusy}
              style={logoutButtonStyle}
            >
              Выйти
            </button>
          </div>

          <h1 style={pageTitleStyle}>Создайте или присоединитесь</h1>

          <p
            style={{
              marginTop: 0,
              marginBottom: 28,
              color: '#777',
              lineHeight: 1.55,
            }}
          >
            Создайте своё пространство или войдите в общее пространство по
            коду приглашения.
          </p>

          <div style={workspaceSectionStyle}>
            <div style={workspaceSectionTitleStyle}>
              Создать пространство
            </div>

            <label style={fieldLabelStyle}>
              Название
            </label>

            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Например: Наши планы"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !workspaceBusy) {
                  void createWorkspace()
                }
              }}
              style={inputStyle}
            />

            <button
              onClick={() => void createWorkspace()}
              disabled={workspaceBusy}
              style={{
                ...mainButtonStyle,
                marginTop: 18,
                opacity: workspaceBusy ? 0.6 : 1,
              }}
            >
              {workspaceBusy ? 'Подождите…' : 'Создать пространство'}
            </button>
          </div>

          <div style={workspaceDividerStyle}>
            <div style={workspaceDividerLineStyle} />
            <span style={workspaceDividerTextStyle}>или</span>
            <div style={workspaceDividerLineStyle} />
          </div>

          <div style={workspaceSectionStyle}>
            <div style={workspaceSectionTitleStyle}>
              Присоединиться к друзьям
            </div>

            <label style={fieldLabelStyle}>
              Код приглашения
            </label>

            <input
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value.toUpperCase())
              }
              placeholder="Например: A7K9P2XF"
              maxLength={20}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !workspaceBusy) {
                  void joinWorkspace()
                }
              }}
              style={{
                ...inputStyle,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            />

            <button
              onClick={() => void joinWorkspace()}
              disabled={workspaceBusy}
              style={{
                ...secondaryButtonStyle,
                marginTop: 18,
                opacity: workspaceBusy ? 0.6 : 1,
              }}
            >
              {workspaceBusy ? 'Подождите…' : 'Присоединиться'}
            </button>
          </div>

          {workspaceError && (
            <div style={authErrorStyle}>
              {workspaceError}
            </div>
          )}
        </div>
      </div>
    )
  }

  const userEmail = profile?.email || session.user.email || 'Пользователь'
  const userDisplayName = profile?.display_name || userEmail

  if (!preferencesLoading && onboardingStep === 'preferences') {
    return (
      <div style={pageContainerStyle}>
        <h1 style={pageTitleStyle}>Расскажите, что вам нравится</h1>
        <p style={pageDescriptionStyle}>
          Напишите своими словами, какие места, мероприятия и форматы вам
          обычно нравятся. Можно написать и то, что вы не любите.
        </p>
        <div style={contentCardStyle}>
          <label style={fieldLabelStyle}>Мои предпочтения</label>
          <textarea
            value={preferenceTextDraft}
            onChange={(event) => setPreferenceTextDraft(event.target.value)}
            rows={8}
            placeholder="Люблю камерные концерты, современное искусство, необычные кафе, прогулки и небольшие мероприятия. Не люблю большие толпы и шумные клубы. Обычно готов потратить до 5000 ₽."
            disabled={preferencesBusy}
            style={textareaStyle}
          />
          <label style={fieldLabelStyle}>Основной город</label>
          <select
            value={preferenceCityDraft}
            onChange={(event) => setPreferenceCityDraft(event.target.value)}
            disabled={preferencesBusy}
            style={inputStyle}
          >
            {DISCOVERY_LOCATIONS.map((location) => (
              <option key={location.slug} value={location.slug}>
                {location.name}
              </option>
            ))}
          </select>
          {preferencesError && <div style={authErrorStyle}>{preferencesError}</div>}
          <button
            onClick={() => void saveUserPreferences(true)}
            disabled={preferencesBusy}
            style={{ ...mainButtonStyle, marginTop: 18 }}
          >
            {preferencesBusy ? 'Сохраняю…' : 'Продолжить'}
          </button>
          <button
            onClick={() => setOnboardingStep(null)}
            disabled={preferencesBusy}
            style={cancelButtonStyle}
          >
            Пропустить пока
          </button>
        </div>
      </div>
    )
  }

  if (onboardingStep === 'calibration') {
    const calibrationEvent = calibrationEvents[calibrationIndex]

    return (
      <div style={pageContainerStyle}>
        <h1 style={pageTitleStyle}>Давайте немного уточним ваши вкусы</h1>
        <p style={pageDescriptionStyle}>
          Выберите отношение к нескольким реальным мероприятиям.
        </p>
        {calibrationLoading && <div style={emptyRankingStyle}>Загрузка…</div>}
        {calibrationError && <div style={authErrorStyle}>{calibrationError}</div>}
        {!calibrationLoading && calibrationEvent && (
          <>
            <div style={calibrationProgressStyle}>
              {calibrationIndex + 1} из {calibrationEvents.length}
            </div>
            <CalibrationEventCard event={calibrationEvent} />
            <div style={calibrationActionsStyle}>
              <button
                onClick={() => void answerCalibration('interested')}
                disabled={calibrationBusy}
                style={secondaryButtonStyle}
              >
                ❤️ Нравится
              </button>
              <button
                onClick={() => void answerCalibration('not_interested')}
                disabled={calibrationBusy}
                style={secondaryButtonStyle}
              >
                👎 Не моё
              </button>
              <button
                onClick={() => void answerCalibration()}
                disabled={calibrationBusy}
                style={cancelButtonStyle}
              >
                → Пропустить
              </button>
            </div>
          </>
        )}
        {!calibrationLoading && !calibrationEvent && (
          <button onClick={() => setOnboardingStep(null)} style={cancelButtonStyle}>
            Вернуться в приложение
          </button>
        )}
      </div>
    )
  }

  if (onboardingStep === 'complete') {
    return (
      <div style={pageContainerStyle}>
        <div style={contentCardStyle}>
          <h1 style={pageTitleStyle}>Готово!</h1>
          <p style={pageDescriptionStyle}>
            Мы получили первое представление о ваших предпочтениях.
          </p>
          <button
            onClick={() => {
              setOnboardingStep(null)
              setActiveView('discovery')
            }}
            style={mainButtonStyle}
          >
            Перейти в Афишу
          </button>
        </div>
      </div>
    )
  }

  if (activeView === 'calendar') {
    const todayKey = localDateKey(new Date())
    const calendarEvents = planEvents
      .filter((event) => plans.some((plan) => plan.id === event.plan_id))
      .sort((a, b) => Date.parse(a.planned_at) - Date.parse(b.planned_at))
    const eventsForDate = (dateKey: string) => calendarEvents.filter(
      (event) => localDateKey(new Date(event.planned_at)) === dateKey
    )
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
    const gridStart = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth(),
      1 - ((monthStart.getDay() + 6) % 7)
    )
    const monthDays = Array.from({ length: 42 }, (_, index) => new Date(
      gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index
    ))
    const selectedDayEvents = eventsForDate(selectedCalendarDate)
    const visibleListEvents = calendarEvents.filter(
      (event) => showPastCalendarEvents || Date.parse(event.planned_at) >= now
    )
    const listGroups = new Map<string, PlanEvent[]>()
    visibleListEvents.forEach((event) => {
      const key = localDateKey(new Date(event.planned_at))
      listGroups.set(key, [...(listGroups.get(key) ?? []), event])
    })
    const changeCalendarMonth = (offset: number) => {
      const nextMonth = new Date(
        calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1
      )
      setCalendarMonth(nextMonth)
      setSelectedCalendarDate(localDateKey(nextMonth))
    }

    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>📅 Календарь</h1>
        <p style={pageDescriptionStyle}>Общие планы группы «{activeGroup.name}».</p>

        <div style={calendarModeStyle}>
          {(['month', 'list'] as CalendarMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCalendarMode(mode)}
              style={{
                ...calendarModeButtonStyle,
                ...(calendarMode === mode ? calendarModeButtonActiveStyle : {}),
              }}
            >
              {mode === 'month' ? 'Месяц' : 'Список'}
            </button>
          ))}
        </div>

        {calendarEvents.length === 0 ? (
          <div style={calendarEmptyStyle}>
            <div style={{ fontSize: 32 }}>📅</div>
            <h2 style={{ ...sectionTitleStyle, marginTop: 12 }}>
              Пока ничего не запланировано
            </h2>
            <p style={{ ...pageDescriptionStyle, marginBottom: 16 }}>
              Когда кто-нибудь из группы нажмёт «✅ Идём» у плана, он появится здесь.
            </p>
            <button
              type="button"
              onClick={() => setActiveView('home')}
              style={mainButtonStyle}
            >
              Перейти в Мои планы
            </button>
          </div>
        ) : calendarMode === 'month' ? (
          <>
            <div style={calendarMonthHeaderStyle}>
              <button
                type="button"
                aria-label="Предыдущий месяц"
                onClick={() => changeCalendarMonth(-1)}
                style={calendarArrowStyle}
              >‹</button>
              <strong>{calendarMonth.toLocaleDateString('ru-RU', {
                month: 'long', year: 'numeric',
              })}</strong>
              <button
                type="button"
                aria-label="Следующий месяц"
                onClick={() => changeCalendarMonth(1)}
                style={calendarArrowStyle}
              >›</button>
            </div>
            <div style={calendarGridStyle}>
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((weekday) => (
                <div key={weekday} style={calendarWeekdayStyle}>{weekday}</div>
              ))}
              {monthDays.map((date) => {
                const key = localDateKey(date)
                const count = eventsForDate(key).length
                const isCurrentMonth = date.getMonth() === calendarMonth.getMonth()
                const isSelected = key === selectedCalendarDate
                const isToday = key === todayKey
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCalendarDate(key)}
                    style={{
                      ...calendarDayStyle,
                      opacity: isCurrentMonth ? 1 : 0.38,
                      ...(isSelected ? calendarDaySelectedStyle : {}),
                      ...(isToday ? calendarTodayStyle : {}),
                    }}
                  >
                    <span>{date.getDate()}</span>
                    {count > 0 && <span style={calendarMarkerStyle}>• {count}</span>}
                  </button>
                )
              })}
            </div>

            <h2 style={{ ...sectionTitleStyle, marginTop: 24 }}>
              {formatCalendarDate(new Date(`${selectedCalendarDate}T12:00:00`))}
            </h2>
            {selectedDayEvents.length === 0 ? (
              <div style={emptyRankingStyle}>На этот день ничего не запланировано</div>
            ) : (
              <div style={calendarEventListStyle}>
                {selectedDayEvents.map((event) => {
                  const plan = plans.find((item) => item.id === event.plan_id)
                  return plan ? (
                    <CalendarEventCard
                      key={event.id}
                      event={event}
                      plan={plan}
                      onOpenPlan={() => openPlanFromCalendar(plan)}
                      onEdit={() => openCalendarEventEditor(event)}
                    />
                  ) : null
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowPastCalendarEvents((current) => !current)}
              aria-pressed={showPastCalendarEvents}
              style={discoveryHiddenToggleStyle}
            >
              {showPastCalendarEvents ? 'Скрыть прошедшие' : 'Показать прошедшие'}
            </button>
            {listGroups.size === 0 ? (
              <div style={{ ...emptyRankingStyle, marginTop: 18 }}>
                Ближайших событий пока нет
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                {[...listGroups.entries()].map(([key, events]) => (
                  <section key={key} style={{ marginBottom: 24 }}>
                    <h2 style={calendarListDateStyle}>
                      {formatCalendarDate(new Date(`${key}T12:00:00`))}
                    </h2>
                    <div style={calendarEventListStyle}>
                      {events.map((event) => {
                        const plan = plans.find((item) => item.id === event.plan_id)
                        return plan ? (
                          <CalendarEventCard
                            key={event.id}
                            event={event}
                            plan={plan}
                            onOpenPlan={() => openPlanFromCalendar(plan)}
                            onEdit={() => openCalendarEventEditor(event)}
                          />
                        ) : null
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {editingCalendarEvent && (
          <div style={overlayStyle} onClick={closeCalendarEventEditor}>
            <div style={overlayPanelStyle} onClick={(event) => event.stopPropagation()}>
              <h2 style={sheetTitleStyle}>Изменить поход</h2>
              <label style={fieldLabelStyle}>Дата</label>
              <input
                type="date"
                value={calendarEditDate}
                onChange={(event) => setCalendarEditDate(event.target.value)}
                disabled={calendarEventBusy}
                style={inputStyle}
              />
              <label style={fieldLabelStyle}>Время</label>
              <input
                type="time"
                value={calendarEditTime}
                onChange={(event) => setCalendarEditTime(event.target.value)}
                disabled={calendarEventBusy}
                style={inputStyle}
              />
              <label style={fieldLabelStyle}>Комментарий</label>
              <textarea
                value={calendarEditComment}
                onChange={(event) => setCalendarEditComment(event.target.value)}
                disabled={calendarEventBusy}
                style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
              />
              {calendarError && <div style={authErrorStyle}>{calendarError}</div>}
              <button
                type="button"
                onClick={() => void saveCalendarEvent()}
                disabled={calendarEventBusy || !calendarEditDate || !calendarEditTime}
                style={{ ...mainButtonStyle, marginTop: 18 }}
              >
                {calendarEventBusy ? 'Сохраняю…' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => void cancelCalendarEvent()}
                disabled={calendarEventBusy}
                style={{ ...dangerButtonStyle, marginTop: 10 }}
              >
                Отменить поход
              </button>
              <button
                type="button"
                onClick={closeCalendarEventEditor}
                disabled={calendarEventBusy}
                style={{ ...secondaryButtonStyle, marginTop: 10 }}
              >
                Закрыть
              </button>
            </div>
          </div>
        )}

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'places') {
    const effectivePlaceCity = placeCity || userPreferences?.city || ''
    const visiblePlaces = places.filter(
      (place) =>
        showHiddenPlaces ||
        !place.catalog_id ||
        placeFeedback[place.catalog_id] !== 'not_interested'
    )

    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>🍽 Места</h1>
        <p style={pageDescriptionStyle}>
          Реальные рестораны, кафе и бары в вашем городе.
        </p>

        <div style={contentCardStyle}>
          <div style={placeKindSelectorStyle}>
            {PLACE_KINDS.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => {
                  setPlaceKind(item.kind)
                  setPlaces([])
                  setPlacesSearched(false)
                  setPlacesError('')
                }}
                disabled={placesLoading}
                aria-pressed={placeKind === item.kind}
                style={{
                  ...placeKindButtonStyle,
                  ...(placeKind === item.kind ? placeKindButtonActiveStyle : {}),
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label style={fieldLabelStyle}>Город</label>
          <select
            value={effectivePlaceCity}
            onChange={(event) => {
              setPlaceCity(event.target.value)
              setPlaces([])
              setPlacesSearched(false)
              setPlacesError('')
            }}
            disabled={placesLoading}
            style={inputStyle}
          >
            {!effectivePlaceCity && <option value="">Выберите город</option>}
            {DISCOVERY_LOCATIONS.map((location) => (
              <option key={location.slug} value={location.slug}>
                {location.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => void searchPlaces()}
            disabled={placesLoading || !effectivePlaceCity}
            style={{
              ...mainButtonStyle,
              marginTop: 18,
              opacity: placesLoading || !effectivePlaceCity ? 0.6 : 1,
            }}
          >
            {placesLoading ? 'Ищу…' : 'Найти места'}
          </button>

          <button
            type="button"
            onClick={() => setShowHiddenPlaces((current) => !current)}
            aria-pressed={showHiddenPlaces}
            style={discoveryHiddenToggleStyle}
          >
            {showHiddenPlaces ? 'Скрыть отмеченные «Не моё»' : 'Показать скрытые'}
          </button>
        </div>

        {placesError && <div style={authErrorStyle}>{placesError}</div>}
        {placeFeedbackError && <div style={authErrorStyle}>{placeFeedbackError}</div>}
        {placePlanError && <div style={authErrorStyle}>{placePlanError}</div>}
        {placePlanMessage && <div style={authSuccessStyle}>{placePlanMessage}</div>}

        {!placesLoading && placesSearched && !placesError && places.length === 0 && (
          <div style={emptyRankingStyle}>Подходящие места не найдены.</div>
        )}

        {!placesLoading && places.length > 0 && visiblePlaces.length === 0 && (
          <div style={emptyRankingStyle}>
            Все найденные места скрыты. Включите «Показать скрытые».
          </div>
        )}

        {!placesLoading && visiblePlaces.length > 0 && (
          <div style={placeListStyle}>
            {visiblePlaces.map((place) => (
              <PlaceCard
                key={`${place.source}:${place.source_place_id}`}
                place={place}
                reaction={place.catalog_id ? placeFeedback[place.catalog_id] : undefined}
                feedbackBusy={Boolean(
                  place.catalog_id && placeFeedbackBusy === place.catalog_id
                )}
                planBusy={Boolean(place.catalog_id && placePlanBusy === place.catalog_id)}
                alreadyAdded={Boolean(
                  place.catalog_id && plans.some(
                    (plan) => plan.place_catalog_id === place.catalog_id
                  )
                )}
                onReaction={(reaction) => {
                  if (place.catalog_id) void togglePlaceReaction(place.catalog_id, reaction)
                }}
                onAddToPlans={() => void addPlaceToPlans(place)}
              />
            ))}
          </div>
        )}

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'recommendations') {
    const visibleRecommendations = recommendations.filter(
      (event) => discoveryFeedback[event.catalog_id] !== 'not_interested'
    )
    const visiblePlaceRecommendations = placeRecommendations.filter(
      (place) => placeFeedback[place.catalog_id] !== 'not_interested'
    )
    const recommendationsBusy = recommendationsLoading || placeRecommendationsLoading

    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>✨ Для меня</h1>
        <p style={pageDescriptionStyle}>
          Подборка на основе ваших интересов и истории.
        </p>

        {!userPreferences?.onboarding_completed ? (
          <div style={contentCardStyle}>
            <h2 style={sectionTitleStyle}>Расскажите о своих вкусах</h2>
            <p style={{ ...pageDescriptionStyle, marginBottom: 16 }}>
              Заполните предпочтения, чтобы мы могли подобрать подходящие мероприятия.
            </p>
            <button
              onClick={() => setOnboardingStep('preferences')}
              style={mainButtonStyle}
            >
              Рассказать о вкусах
            </button>
          </div>
        ) : (
          <>
            {recommendationsFeedbackCount < 5 && (
              <div style={recommendationHintStyle}>
                Чем больше вы оцениваете мероприятия, тем точнее становятся рекомендации.
              </div>
            )}

            <button
              onClick={loadAllRecommendations}
              disabled={recommendationsBusy}
              style={{
                ...mainButtonStyle,
                marginBottom: 18,
                opacity: recommendationsBusy ? 0.6 : 1,
              }}
            >
              {recommendationsBusy
                ? 'Подбираю…'
                : recommendationsSearched || placeRecommendationsSearched
                  ? '✨ Подобрать ещё'
                  : '✨ Подобрать рекомендации'}
            </button>

            {recommendationsError && (
              <div style={authErrorStyle}>{recommendationsError}</div>
            )}
            {discoveryFeedbackError && (
              <div style={authErrorStyle}>{discoveryFeedbackError}</div>
            )}
            {discoveryPlanError && (
              <div style={authErrorStyle}>{discoveryPlanError}</div>
            )}
            {discoveryPlanMessage && (
              <div style={authSuccessStyle}>{discoveryPlanMessage}</div>
            )}
            {placeRecommendationsError && (
              <div style={authErrorStyle}>{placeRecommendationsError}</div>
            )}
            {placeFeedbackError && (
              <div style={authErrorStyle}>{placeFeedbackError}</div>
            )}
            {placePlanError && (
              <div style={authErrorStyle}>{placePlanError}</div>
            )}
            {placePlanMessage && (
              <div style={authSuccessStyle}>{placePlanMessage}</div>
            )}

            <h2 style={sectionTitleStyle}>🎟 Мероприятия для вас</h2>

            {!recommendationsLoading &&
              recommendationsSearched &&
              !recommendationsError &&
              visibleRecommendations.length === 0 && (
                <div style={emptyRankingStyle}>
                  Пока не удалось найти новые подходящие мероприятия.
                </div>
              )}

            {!recommendationsLoading && visibleRecommendations.length > 0 && (
              <div style={discoveryListStyle}>
                {visibleRecommendations.map((event) => {
                  const alreadyAdded = event.is_in_plans || plans.some(
                    (plan) => plan.event_catalog_id === event.catalog_id
                  )

                  return (
                    <DiscoveryEventCard
                      key={event.catalog_id}
                      event={event}
                      reaction={discoveryFeedback[event.catalog_id]}
                      reasons={event.reasons}
                      feedbackBusy={discoveryFeedbackBusy === event.catalog_id}
                      planBusy={discoveryPlanBusy === event.catalog_id}
                      alreadyAdded={alreadyAdded}
                      onReaction={(reaction) =>
                        void toggleDiscoveryReaction(event.catalog_id, reaction)
                      }
                      onAddToPlans={() => void addDiscoveryEventToPlans(event)}
                    />
                  )
                })}
              </div>
            )}

            <h2 style={{ ...sectionTitleStyle, marginTop: 28 }}>🍽 Места для вас</h2>
            {placeRecommendationsFeedbackCount < 5 && (
              <div style={recommendationHintStyle}>
                Чем больше вы оцениваете места, тем точнее становятся рекомендации.
              </div>
            )}

            {!placeRecommendationsLoading &&
              placeRecommendationsSearched &&
              !placeRecommendationsError &&
              visiblePlaceRecommendations.length === 0 && (
                <div style={emptyRankingStyle}>
                  Пока не удалось найти подходящие места в вашем городе.
                </div>
              )}

            {!placeRecommendationsLoading && visiblePlaceRecommendations.length > 0 && (
              <div style={placeListStyle}>
                {visiblePlaceRecommendations.map((place) => (
                  <PlaceCard
                    key={place.catalog_id}
                    place={place}
                    reaction={placeFeedback[place.catalog_id]}
                    reasons={place.reasons}
                    feedbackBusy={placeFeedbackBusy === place.catalog_id}
                    planBusy={placePlanBusy === place.catalog_id}
                    alreadyAdded={place.is_in_plans || plans.some(
                      (plan) => plan.place_catalog_id === place.catalog_id
                    )}
                    onReaction={(reaction) =>
                      void togglePlaceReaction(place.catalog_id, reaction)
                    }
                    onAddToPlans={() => void addPlaceToPlans(place)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <div style={discoverySourceStyle}>
          Источники данных:{' '}
          <a href="https://kudago.com/" target="_blank" rel="noreferrer">
            KudaGo
          </a>
          {' · '}
          <a href="https://foursquare.com/" target="_blank" rel="noreferrer">
            Foursquare
          </a>
        </div>

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'discovery') {
    const visibleDiscoveryEvents = discoveryEvents.filter(
      (event) =>
        showHiddenDiscoveryEvents ||
        discoveryFeedback[event.catalog_id] !== 'not_interested'
    )

    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>🔎 Афиша</h1>
        <p style={pageDescriptionStyle}>
          Реальные мероприятия в выбранном городе и периоде.
        </p>

        <div style={contentCardStyle}>
          <label style={fieldLabelStyle}>Город</label>
          <select
            value={discoveryLocation}
            onChange={(event) => setDiscoveryLocation(event.target.value)}
            disabled={discoveryLoading}
            style={inputStyle}
          >
            {DISCOVERY_LOCATIONS.map((location) => (
              <option key={location.slug} value={location.slug}>
                {location.name}
              </option>
            ))}
          </select>

          <div style={discoveryPeriodStyle}>
            {DISCOVERY_PERIODS.map((period) => (
              <button
                key={period.days}
                onClick={() => setDiscoveryPeriod(period.days)}
                disabled={discoveryLoading}
                style={{
                  ...discoveryPeriodButtonStyle,
                  ...(discoveryPeriod === period.days
                    ? discoveryPeriodActiveStyle
                    : {}),
                }}
              >
                {period.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void searchDiscoveryEvents()}
            disabled={discoveryLoading}
            style={{
              ...mainButtonStyle,
              marginTop: 18,
              opacity: discoveryLoading ? 0.6 : 1,
            }}
          >
            {discoveryLoading ? 'Загрузка…' : 'Найти мероприятия'}
          </button>

          <button
            type="button"
            onClick={() => setShowHiddenDiscoveryEvents((current) => !current)}
            aria-pressed={showHiddenDiscoveryEvents}
            style={{
              ...discoveryHiddenToggleStyle,
              ...(showHiddenDiscoveryEvents
                ? discoveryHiddenToggleActiveStyle
                : {}),
            }}
          >
            {showHiddenDiscoveryEvents ? 'Скрыть отмеченные «Не моё»' : 'Показать скрытые'}
          </button>
        </div>

        {discoveryError && <div style={authErrorStyle}>{discoveryError}</div>}
        {discoveryFeedbackError && (
          <div style={authErrorStyle}>{discoveryFeedbackError}</div>
        )}
        {discoveryPlanError && (
          <div style={authErrorStyle}>{discoveryPlanError}</div>
        )}
        {discoveryPlanMessage && (
          <div style={authSuccessStyle}>{discoveryPlanMessage}</div>
        )}

        {!discoveryLoading &&
          discoverySearched &&
          !discoveryError &&
          visibleDiscoveryEvents.length === 0 && (
            <div style={emptyRankingStyle}>
              {discoveryEvents.length > 0
                ? 'Все найденные мероприятия скрыты вашей реакцией «Не моё»'
                : 'На выбранный период мероприятия не найдены'}
            </div>
          )}

        {!discoveryLoading && visibleDiscoveryEvents.length > 0 && (
          <div style={discoveryListStyle}>
            {visibleDiscoveryEvents.map((event) => {
              const alreadyAdded = plans.some(
                (plan) => plan.event_catalog_id === event.catalog_id
              )

              return (
                <DiscoveryEventCard
                  key={event.catalog_id}
                  event={event}
                  reaction={discoveryFeedback[event.catalog_id]}
                  feedbackBusy={discoveryFeedbackBusy === event.catalog_id}
                  planBusy={discoveryPlanBusy === event.catalog_id}
                  alreadyAdded={alreadyAdded}
                  onReaction={(reaction) =>
                    void toggleDiscoveryReaction(event.catalog_id, reaction)
                  }
                  onAddToPlans={() => void addDiscoveryEventToPlans(event)}
                />
              )
            })}
          </div>
        )}

        <div style={discoverySourceStyle}>
          Источник данных:{' '}
          <a href="https://kudago.com/" target="_blank" rel="noreferrer">
            KudaGo
          </a>
        </div>

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'profile') {
    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>👤 Профиль</h1>
        <p style={pageDescriptionStyle}>
          Это имя увидят участники вашей группы.
        </p>

        <div style={contentCardStyle}>
          <label style={fieldLabelStyle}>Имя</label>
          <input
            value={profileName}
            onChange={(event) => {
              setProfileName(event.target.value)
              setProfileMessage('')
            }}
            placeholder={userEmail}
            style={inputStyle}
          />

          <label style={fieldLabelStyle}>Email</label>
          <input value={userEmail} readOnly style={readOnlyInputStyle} />

          {profileError && <div style={authErrorStyle}>{profileError}</div>}
          {profileMessage && <div style={authSuccessStyle}>{profileMessage}</div>}

          <button
            onClick={() => void saveProfile()}
            disabled={profileBusy}
            style={{
              ...mainButtonStyle,
              marginTop: 20,
              opacity: profileBusy ? 0.6 : 1,
            }}
          >
            {profileBusy ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>

        <h2 style={{ ...sectionTitleStyle, marginTop: 28 }}>Мои вкусы</h2>
        <div style={contentCardStyle}>
          {preferencesLoading && <div>Загрузка предпочтений…</div>}
          {!preferencesLoading && preferencesEditing ? (
            <>
              <label style={fieldLabelStyle}>Предпочтения</label>
              <textarea
                value={preferenceTextDraft}
                onChange={(event) => setPreferenceTextDraft(event.target.value)}
                rows={7}
                disabled={preferencesBusy}
                style={textareaStyle}
              />
              <label style={fieldLabelStyle}>Основной город</label>
              <select
                value={preferenceCityDraft}
                onChange={(event) => setPreferenceCityDraft(event.target.value)}
                disabled={preferencesBusy}
                style={inputStyle}
              >
                {DISCOVERY_LOCATIONS.map((location) => (
                  <option key={location.slug} value={location.slug}>
                    {location.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void saveUserPreferences(false)}
                disabled={preferencesBusy}
                style={{ ...mainButtonStyle, marginTop: 18 }}
              >
                {preferencesBusy ? 'Сохраняю…' : 'Сохранить предпочтения'}
              </button>
              <button
                onClick={() => {
                  setPreferencesEditing(false)
                  setPreferenceTextDraft(userPreferences?.preference_text ?? '')
                  setPreferenceCityDraft(userPreferences?.city ?? 'msk')
                  setPreferencesError('')
                }}
                disabled={preferencesBusy}
                style={cancelButtonStyle}
              >
                Отмена
              </button>
            </>
          ) : (
            !preferencesLoading && (
              <>
                <div style={preferencesTextStyle}>
                  {userPreferences?.preference_text || 'Предпочтения пока не заполнены.'}
                </div>
                <div style={preferencesCityStyle}>
                  Город:{' '}
                  {DISCOVERY_LOCATIONS.find(
                    (location) => location.slug === userPreferences?.city
                  )?.name ?? 'Не выбран'}
                </div>
                <button
                  onClick={() => {
                    setPreferenceTextDraft(userPreferences?.preference_text ?? '')
                    setPreferenceCityDraft(userPreferences?.city ?? 'msk')
                    setPreferencesEditing(true)
                    setPreferencesMessage('')
                  }}
                  style={{ ...secondaryButtonStyle, marginTop: 16 }}
                >
                  Изменить предпочтения
                </button>
                <button
                  onClick={() => void startCalibration(undefined, true)}
                  style={{ ...secondaryButtonStyle, marginTop: 10 }}
                >
                  Пройти калибровку заново
                </button>
              </>
            )
          )}
          {preferencesError && <div style={authErrorStyle}>{preferencesError}</div>}
          {preferencesMessage && (
            <div style={authSuccessStyle}>{preferencesMessage}</div>
          )}
        </div>

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'group') {
    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <h1 style={pageTitleStyle}>👥 Группа</h1>
        <p style={pageDescriptionStyle}>
          Общее пространство для планов и оценок участников.
        </p>

        <div style={contentCardStyle}>
          <div style={groupNameSectionStyle}>
            <div style={infoLabelStyle}>Название группы</div>

            {editingGroupName ? (
              <>
                <input
                  value={groupNameDraft}
                  onChange={(event) => {
                    setGroupNameDraft(event.target.value)
                    setGroupNameError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !groupNameBusy) {
                      void saveGroupName()
                    }
                  }}
                  disabled={groupNameBusy}
                  autoFocus
                  style={inputStyle}
                />

                {groupNameError && (
                  <div style={inlineErrorStyle}>{groupNameError}</div>
                )}

                <div style={groupNameActionsStyle}>
                  <button
                    onClick={() => void saveGroupName()}
                    disabled={groupNameBusy}
                    style={{
                      ...smallPrimaryButtonStyle,
                      opacity: groupNameBusy ? 0.6 : 1,
                    }}
                  >
                    {groupNameBusy ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                  <button
                    onClick={cancelEditingGroupName}
                    disabled={groupNameBusy}
                    style={{
                      ...copyInviteButtonStyle,
                      opacity: groupNameBusy ? 0.6 : 1,
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </>
            ) : (
              <div style={groupNameRowStyle}>
                <strong>{activeGroup.name}</strong>
                {activeGroupRole === 'owner' && (
                  <button
                    onClick={startEditingGroupName}
                    style={copyInviteButtonStyle}
                  >
                    ✏️ Изменить
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ paddingTop: 13 }}>
            <div style={infoLabelStyle}>Код приглашения</div>
            <div style={groupInviteRowStyle}>
              <strong style={{ letterSpacing: '0.08em' }}>
                {activeGroup.invite_code || 'Не задан'}
              </strong>
              {activeGroup.invite_code && (
                <button
                  onClick={() => void copyInviteCode()}
                  style={copyInviteButtonStyle}
                >
                  {inviteCopied ? 'Скопировано ✓' : 'Скопировать'}
                </button>
              )}
            </div>
          </div>
        </div>

        <h2 style={{ ...sectionTitleStyle, marginTop: 28 }}>
          Участники — {groupMembers.length}
        </h2>

        {peopleLoading && <div style={emptyRankingStyle}>Загружаю участников…</div>}
        {peopleError && <div style={authErrorStyle}>{peopleError}</div>}
        {!peopleLoading && !peopleError && (
          <div style={{ display: 'grid', gap: 10 }}>
            {groupMembers.map((member) => {
              const memberName = member.display_name.trim() || member.email

              return (
                <div key={member.user_id} style={memberCardStyle}>
                  <div style={{ minWidth: 0 }}>
                    <div style={memberNameStyle}>{memberName}</div>
                    {member.display_name.trim() && (
                      <div style={memberEmailStyle}>{member.email}</div>
                    )}
                  </div>
                  <div style={roleBadgeStyle}>
                    {member.role === 'owner' ? 'Владелец' : 'Участник'}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  if (activeView === 'ranking') {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          padding: '28px 18px 96px',
          fontFamily: 'Arial, sans-serif',
          color: '#222',
        }}
      >
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
          canEditGroup={activeGroupRole === 'owner'}
          busy={authBusy}
          onOpenProfile={() => setActiveView('profile')}
          onOpenGroup={() => setActiveView('group')}
          onLogout={handleSignOut}
        />

        <InviteStrip
          code={activeGroup.invite_code}
          copied={inviteCopied}
          onCopy={copyInviteCode}
        />

        <h1 style={pageTitleStyle}>🏆 Рейтинг</h1>

        <p
          style={{
            marginTop: 0,
            marginBottom: 28,
            color: '#777',
            fontSize: 16,
            lineHeight: 1.5,
          }}
        >
          Отдельно сравниваем, насколько планы хочется реализовать и насколько
          они понравились после посещения.
        </p>

        {errorMessage && (
          <div
            style={{
              padding: 14,
              marginBottom: 14,
              borderRadius: 12,
              background: '#fff1f1',
              color: '#9b1c1c',
            }}
          >
            {errorMessage}
          </div>
        )}

        {loading && (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: '#777',
            }}
          >
            Загружаю рейтинг…
          </div>
        )}

        {!loading && (
          <>
            <h2 style={sectionTitleStyle}>💛 Самые желаемые</h2>

            {desiredRanking.length === 0 && (
              <div style={emptyRankingStyle}>
                Пока нет оценок «Желаемое»
              </div>
            )}

            {desiredRanking.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                }}
              >
                {desiredRanking.map(({ plan, average, count }, index) => (
                  <button
                    key={plan.id}
                    onClick={() => openPlanFromRanking(plan)}
                    style={rankingCardStyle}
                  >
                    <div style={rankingNumberStyle}>
                      {index + 1}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 16,
                        }}
                      >
                        {plan.title}
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          color: '#777',
                          fontSize: 13,
                        }}
                      >
                        {plan.type}
                      </div>

                      <div
                        style={{
                          marginTop: 6,
                          color: '#777',
                          fontSize: 13,
                        }}
                      >
                        {count}{' '}
                        {count === 1
                          ? 'оценка'
                          : count >= 2 && count <= 4
                            ? 'оценки'
                            : 'оценок'}
                      </div>
                    </div>

                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 17,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {average.toFixed(1)}/10
                    </div>
                  </button>
                ))}
              </div>
            )}

            <h2
              style={{
                ...sectionTitleStyle,
                marginTop: 34,
              }}
            >
              ⭐ Лучшие по факту
            </h2>

            {factRanking.length === 0 && (
              <div style={emptyRankingStyle}>
                Пока нет оценок после состоявшихся походов
              </div>
            )}

            {factRanking.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                }}
              >
                {factRanking.map(({ plan, average, count }, index) => (
                  <button
                    key={plan.id}
                    onClick={() => openPlanFromRanking(plan)}
                    style={rankingCardStyle}
                  >
                    <div style={rankingNumberStyle}>
                      {index + 1}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 16,
                        }}
                      >
                        {plan.title}
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          color: '#777',
                          fontSize: 13,
                        }}
                      >
                        {count}{' '}
                        {count === 1
                          ? 'оценка'
                          : count >= 2 && count <= 4
                            ? 'оценки'
                            : 'оценок'}
                      </div>
                    </div>

                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 17,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {average.toFixed(1)}/10
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigateTo}
          onAdd={() => {
            setActiveView('home')
            setShowAddForm(true)
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '28px 18px 96px',
        fontFamily: 'Arial, sans-serif',
        color: '#222',
      }}
    >
      <UserBar
        email={userEmail}
        displayName={userDisplayName}
        groupName={activeGroup.name}
        canEditGroup={activeGroupRole === 'owner'}
        busy={authBusy}
        onOpenProfile={() => setActiveView('profile')}
        onOpenGroup={() => setActiveView('group')}
        onLogout={handleSignOut}
      />

      <InviteStrip
        code={activeGroup.invite_code}
        copied={inviteCopied}
        onCopy={copyInviteCode}
      />

      <h1 style={pageTitleStyle}>Планы</h1>

      <p
        style={{
          marginTop: 0,
          marginBottom: 24,
          color: '#777',
          fontSize: 16,
          lineHeight: 1.5,
        }}
      >
        Куда пойдём сегодня?
      </p>

      <button
        onClick={chooseRandomPlan}
        disabled={loading || plans.length === 0}
        style={{
          ...mainButtonStyle,
          opacity: loading || plans.length === 0 ? 0.5 : 1,
        }}
      >
        🎲 Случайный план
      </button>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="🔎 Найти план"
        style={{
          ...inputStyle,
          marginTop: 22,
        }}
      />

      <h2 style={{ ...sectionTitleStyle, marginTop: 32 }}>Запланировано</h2>

      {!loading && plannedEvents.length === 0 && (
        <div
          style={{
            padding: 18,
            border: '1px dashed #ddd',
            borderRadius: 16,
            color: '#777',
            textAlign: 'center',
          }}
        >
          Пока ничего не запланировано
        </div>
      )}

      {!loading && plannedEvents.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 10,
          }}
        >
          {plannedEvents.map((event) => {
            const plan = plans.find((item) => item.id === event.plan_id)

            if (!plan) {
              return null
            }

            return (
              <div
                key={event.id}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  border: '1px solid #e5e5e5',
                  borderRadius: 16,
                  padding: 16,
                  background: '#fafafa',
                  color: '#222',
                }}
              >
                <button
                  onClick={() => setSelectedPlan(plan)}
                  style={{
                    width: '100%',
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: '#222',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: '#777',
                      marginBottom: 5,
                    }}
                  >
                    📅 {formatPlannedAt(event.planned_at)}
                  </div>

                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 17,
                    }}
                  >
                    {plan.title}
                  </div>

                  {event.comment && (
                    <div
                      style={{
                        marginTop: 7,
                        color: '#555',
                        fontSize: 14,
                      }}
                    >
                      💬 {event.comment}
                    </div>
                  )}
                </button>

              </div>
            )
          })}
        </div>
      )}

      <h2 style={{ ...sectionTitleStyle, marginTop: 32 }}>Состоялось</h2>

      {!loading && completedEvents.length === 0 && (
        <div
          style={{
            padding: 18,
            border: '1px dashed #ddd',
            borderRadius: 16,
            color: '#777',
            textAlign: 'center',
          }}
        >
          Пока ничего не состоялось
        </div>
      )}

      {!loading && completedEvents.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 10,
          }}
        >
          {completedEvents.map((event) => {
            const plan = plans.find((item) => item.id === event.plan_id)
            const myRating = getMyEventRating(event.id)
            const ratingSummary = getEventRatingSummary(event.id)

            if (!plan) {
              return null
            }

            return (
              <div
                key={event.id}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  border: '1px solid #e5e5e5',
                  borderRadius: 16,
                  padding: 16,
                  background: 'white',
                  color: '#222',
                }}
              >
                <button
                  onClick={() => setSelectedPlan(plan)}
                  style={{
                    width: '100%',
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: '#222',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: '#777',
                      marginBottom: 5,
                    }}
                  >
                    ✅ {formatPlannedAt(event.planned_at)}
                  </div>

                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 17,
                    }}
                  >
                    {plan.title}
                  </div>

                  {event.comment && (
                    <div
                      style={{
                        marginTop: 7,
                        color: '#555',
                        fontSize: 14,
                      }}
                    >
                      💬 {event.comment}
                    </div>
                  )}

                  {(myRating || ratingSummary.count > 0) && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 10,
                        background: '#f7f7f7',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                        }}
                      >
                        ⭐ Моя оценка по факту:{' '}
                        {myRating ? `${myRating.score}/10` : 'нет'}
                      </div>

                      {ratingSummary.count > 0 && (
                        <div
                          style={{
                            marginTop: 5,
                            color: '#555',
                            fontSize: 14,
                          }}
                        >
                          Средняя по группе: {ratingSummary.average.toFixed(1)}/10
                          {' · '}{ratingSummary.count}{' '}
                          {ratingSummary.count === 1
                            ? 'оценка'
                            : ratingSummary.count >= 2 && ratingSummary.count <= 4
                              ? 'оценки'
                              : 'оценок'}
                        </div>
                      )}

                      {myRating?.comment && (
                        <div
                          style={{
                            marginTop: 5,
                            color: '#555',
                            fontSize: 14,
                          }}
                        >
                          {myRating.comment}
                        </div>
                      )}
                    </div>
                  )}
                </button>

                <button
                  onClick={() => openFactRatingForm(event)}
                  style={{
                    ...factButtonStyle,
                    marginTop: 12,
                  }}
                >
                  ⭐ {myRating ? 'Изменить оценку по факту' : 'Оценить по факту'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <h2 style={{ ...sectionTitleStyle, marginTop: 32 }}>Все планы</h2>

      {errorMessage && (
        <div
          style={{
            padding: 14,
            marginBottom: 14,
            borderRadius: 12,
            background: '#fff1f1',
            color: '#9b1c1c',
          }}
        >
          {errorMessage}
        </div>
      )}

      {loading && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: '#777',
          }}
        >
          Загружаю данные из Supabase…
        </div>
      )}

      {!loading && (
        <div
          style={{
            display: 'grid',
            gap: 12,
          }}
        >
          {filteredPlans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: '1px solid #e5e5e5',
                borderRadius: 16,
                padding: 18,
                background: 'white',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: '#222',
              }}
            >
              <div
                style={{
                  color: '#777',
                  fontSize: 14,
                }}
              >
                {plan.type}
              </div>

              <h3
                style={{
                  margin: '6px 0',
                  fontSize: 18,
                }}
              >
                {plan.title}
              </h3>

              <div>{plan.price}</div>

              {(getMyPlanDesire(plan.id) ||
                getPlanDesireSummary(plan.id).count > 0) && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  💛 Моё: {getMyPlanDesire(plan.id)?.score ?? 'нет'}
                  {getMyPlanDesire(plan.id) ? '/10' : ''}
                  {hasOtherPlanDesires(plan.id) && (
                    <> · Среднее: {getPlanDesireSummary(plan.id).average.toFixed(1)}/10</>
                  )}
                </div>
              )}

              {plan.address && (
                <div
                  style={{
                    marginTop: 8,
                    color: '#555',
                    fontSize: 14,
                  }}
                >
                  📍 {plan.address}
                </div>
              )}

              <div
                style={{
                  marginTop: 8,
                  color: '#777',
                  fontSize: 14,
                }}
              >
                {plan.tags.length > 0
                  ? plan.tags.join(' · ')
                  : 'без тегов'}
              </div>

              <div
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Подробнее →
              </div>
            </button>
          ))}

          {filteredPlans.length === 0 && (
            <div
              style={{
                padding: 20,
                textAlign: 'center',
                color: '#777',
              }}
            >
              Ничего не найдено
            </div>
          )}
        </div>
      )}

      {selectedPlan && (
        <div
          style={overlayStyle}
          onClick={() => setSelectedPlan(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={overlayPanelStyle}
          >
            <div
              style={{
                color: '#777',
                fontSize: 14,
              }}
            >
              {selectedPlan.type}
            </div>

            <h2
              style={{
                ...sheetTitleStyle,
                marginTop: 8,
                marginBottom: 20,
              }}
            >
              {selectedPlan.title}
            </h2>

            <InfoRow
              label="Цена"
              value={selectedPlan.price}
            />

            {selectedPlan.address && (
              <InfoRow
                label="Адрес"
                value={selectedPlan.address}
              />
            )}

            {selectedPlan.note && (
              <InfoRow
                label="Фишка / заметка"
                value={selectedPlan.note}
              />
            )}

            <InfoRow
              label="Теги"
              value={
                selectedPlan.tags.length > 0
                  ? selectedPlan.tags.join(' · ')
                  : 'без тегов'
              }
            />

            {selectedPlan.link && (
              <a
                href={selectedPlan.link}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  boxSizing: 'border-box',
                  width: '100%',
                  padding: 14,
                  borderRadius: 12,
                  background: '#f2f2f2',
                  color: '#222',
                  textAlign: 'center',
                  textDecoration: 'none',
                  marginTop: 14,
                  fontWeight: 600,
                }}
              >
                🔗 Открыть ссылку
              </a>
            )}

            {(getMyPlanDesire(selectedPlan.id) ||
              getPlanDesireSummary(selectedPlan.id).count > 0) && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 12,
                  background: '#fff9e8',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                  }}
                >
                  💛 Моё «Желаемое»:{' '}
                  {getMyPlanDesire(selectedPlan.id)
                    ? `${getMyPlanDesire(selectedPlan.id)?.score}/10`
                    : 'нет'}
                </div>

                {hasOtherPlanDesires(selectedPlan.id) && (
                  <div
                    style={{
                      marginTop: 6,
                      color: '#555',
                      fontSize: 14,
                    }}
                  >
                    Среднее по группе:{' '}
                    {getPlanDesireSummary(selectedPlan.id).average.toFixed(1)}/10
                    {' · '}{getPlanDesireSummary(selectedPlan.id).count}{' '}
                    {getPlanDesireSummary(selectedPlan.id).count === 1
                      ? 'оценка'
                      : getPlanDesireSummary(selectedPlan.id).count >= 2 &&
                          getPlanDesireSummary(selectedPlan.id).count <= 4
                        ? 'оценки'
                        : 'оценок'}
                  </div>
                )}

                {getMyPlanDesire(selectedPlan.id)?.comment && (
                  <div
                    style={{
                      marginTop: 6,
                      color: '#555',
                      fontSize: 14,
                    }}
                  >
                    {getMyPlanDesire(selectedPlan.id)?.comment}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => openDesireForm(selectedPlan)}
              style={{
                ...desireButtonStyle,
                marginTop: 14,
              }}
            >
              💛 {getMyPlanDesire(selectedPlan.id) ? 'Изменить желаемое' : 'Оценить желаемое'}
            </button>

            <button
              onClick={() => startEditing(selectedPlan)}
              style={{
                ...secondaryButtonStyle,
                marginTop: 14,
              }}
            >
              ✏️ Редактировать
            </button>

            <button
              onClick={() => openScheduleForm(selectedPlan)}
              style={{
                ...mainButtonStyle,
                marginTop: 10,
              }}
            >
              ✅ Идём
            </button>

            <button
              onClick={() => deletePlan(selectedPlan)}
              disabled={deleting}
              style={{
                ...dangerButtonStyle,
                marginTop: 10,
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Удаляю…' : '🗑 Удалить'}
            </button>

            <button
              onClick={() => setSelectedPlan(null)}
              disabled={deleting}
              style={cancelButtonStyle}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {showAddForm && (
        <div style={overlayStyle}>
          <div style={overlayPanelStyle}>
            <h2 style={sheetTitleStyle}>Новый план</h2>

            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Название"
              style={inputStyle}
            />

            <input
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
              placeholder="Тип, например Еда"
              style={inputStyle}
            />

            <input
              value={newPrice}
              onChange={(event) => setNewPrice(event.target.value)}
              placeholder="Цена, например 2000 ₽"
              style={inputStyle}
            />

            <input
              value={newAddress}
              onChange={(event) => setNewAddress(event.target.value)}
              placeholder="Адрес"
              style={inputStyle}
            />

            <input
              value={newLink}
              onChange={(event) => setNewLink(event.target.value)}
              placeholder="Ссылка https://..."
              style={inputStyle}
            />

            <textarea
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder="Фишка / заметка"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
              }}
            />

            <input
              value={newTags}
              onChange={(event) => setNewTags(event.target.value)}
              placeholder="Теги, например вечер, кофе"
              style={inputStyle}
            />

            <button
              onClick={addPlan}
              disabled={saving}
              style={{
                ...mainButtonStyle,
                marginTop: 14,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Сохраняю…' : 'Добавить план'}
            </button>

            <button
              onClick={() => setShowAddForm(false)}
              disabled={saving}
              style={cancelButtonStyle}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {editingPlan && (
        <div style={overlayStyle}>
          <div style={overlayPanelStyle}>
            <h2 style={sheetTitleStyle}>Редактировать план</h2>

            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              placeholder="Название"
              style={inputStyle}
            />

            <input
              value={editType}
              onChange={(event) => setEditType(event.target.value)}
              placeholder="Тип"
              style={inputStyle}
            />

            <input
              value={editPrice}
              onChange={(event) => setEditPrice(event.target.value)}
              placeholder="Цена"
              style={inputStyle}
            />

            <input
              value={editAddress}
              onChange={(event) => setEditAddress(event.target.value)}
              placeholder="Адрес"
              style={inputStyle}
            />

            <input
              value={editLink}
              onChange={(event) => setEditLink(event.target.value)}
              placeholder="Ссылка https://..."
              style={inputStyle}
            />

            <textarea
              value={editNote}
              onChange={(event) => setEditNote(event.target.value)}
              placeholder="Фишка / заметка"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
              }}
            />

            <input
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              placeholder="Теги, например вечер, кофе"
              style={inputStyle}
            />

            <button
              onClick={saveEditedPlan}
              disabled={saving}
              style={{
                ...mainButtonStyle,
                marginTop: 14,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Сохраняю…' : 'Сохранить изменения'}
            </button>

            <button
              onClick={cancelEditing}
              disabled={saving}
              style={cancelButtonStyle}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {ratingEvent && (
        <div
          style={overlayStyle}
          onClick={closeFactRatingForm}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={overlayPanelStyle}
          >
            <div
              style={{
                color: '#777',
                fontSize: 14,
              }}
            >
              Как всё прошло на самом деле?
            </div>

            <h2
              style={{
                ...sheetTitleStyle,
                marginTop: 8,
                marginBottom: 8,
              }}
            >
              {plans.find((plan) => plan.id === ratingEvent.plan_id)?.title ??
                'Состоявшийся план'}
            </h2>

            <div
              style={{
                color: '#777',
                fontSize: 14,
                marginBottom: 18,
              }}
            >
              {formatPlannedAt(ratingEvent.planned_at)}
            </div>

            <label style={fieldLabelStyle}>
              Оценка по факту — от 1 до 10
            </label>

            <select
              value={factScore}
              onChange={(event) => setFactScore(event.target.value)}
              style={inputStyle}
            >
              <option value="">Выберите оценку</option>
              {Array.from({ length: 10 }, (_, index) => index + 1).map(
                (score) => (
                  <option
                    key={score}
                    value={score}
                  >
                    {score}/10
                  </option>
                )
              )}
            </select>

            <label style={fieldLabelStyle}>
              Комментарий по факту
            </label>

            <textarea
              value={factComment}
              onChange={(event) => setFactComment(event.target.value)}
              placeholder="Например: место понравилось, но было шумно"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
              }}
            />

            <button
              onClick={saveFactRating}
              disabled={saving}
              style={{
                ...mainButtonStyle,
                marginTop: 16,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Сохраняю…' : 'Сохранить оценку по факту'}
            </button>

            <button
              onClick={closeFactRatingForm}
              disabled={saving}
              style={cancelButtonStyle}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {desirePlan && (
        <div
          style={overlayStyle}
          onClick={closeDesireForm}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={overlayPanelStyle}
          >
            <div
              style={{
                color: '#777',
                fontSize: 14,
              }}
            >
              Насколько хочется этот план?
            </div>

            <h2
              style={{
                ...sheetTitleStyle,
                marginTop: 8,
                marginBottom: 18,
              }}
            >
              {desirePlan.title}
            </h2>

            <label style={fieldLabelStyle}>
              Желаемое — от 1 до 10
            </label>

            <select
              value={desireScore}
              onChange={(event) => setDesireScore(event.target.value)}
              style={inputStyle}
            >
              <option value="">Выберите оценку</option>
              {Array.from({ length: 10 }, (_, index) => index + 1).map(
                (score) => (
                  <option
                    key={score}
                    value={score}
                  >
                    {score}/10
                  </option>
                )
              )}
            </select>

            <label style={fieldLabelStyle}>
              Комментарий
            </label>

            <textarea
              value={desireComment}
              onChange={(event) => setDesireComment(event.target.value)}
              placeholder="Например: очень хочу сходить летом"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
              }}
            />

            <button
              onClick={saveDesire}
              disabled={saving}
              style={{
                ...mainButtonStyle,
                marginTop: 16,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Сохраняю…' : 'Сохранить желаемое'}
            </button>

            <button
              onClick={closeDesireForm}
              disabled={saving}
              style={cancelButtonStyle}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {schedulingPlan && (
        <div
          style={overlayStyle}
          onClick={closeScheduleForm}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={overlayPanelStyle}
          >
            <div
              style={{
                color: '#777',
                fontSize: 14,
              }}
            >
              Планируем
            </div>

            <h2
              style={{
                ...sheetTitleStyle,
                marginTop: 8,
                marginBottom: 18,
              }}
            >
              {schedulingPlan.title}
            </h2>

            <label style={fieldLabelStyle}>
              Дата
            </label>

            <input
              type="date"
              value={scheduleDate}
              onChange={(event) => setScheduleDate(event.target.value)}
              style={inputStyle}
            />

            <label style={fieldLabelStyle}>
              Время
            </label>

            <input
              type="time"
              value={scheduleTime}
              onChange={(event) => setScheduleTime(event.target.value)}
              style={inputStyle}
            />

            <label style={fieldLabelStyle}>
              Комментарий
            </label>

            <textarea
              value={scheduleComment}
              onChange={(event) => setScheduleComment(event.target.value)}
              placeholder="Например: забронировать столик"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
              }}
            />

            <button
              onClick={savePlanEvent}
              disabled={saving}
              style={{
                ...mainButtonStyle,
                marginTop: 16,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Сохраняю…' : 'Запланировать'}
            </button>

            <button
              onClick={closeScheduleForm}
              disabled={saving}
              style={cancelButtonStyle}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <BottomNavigation
        activeView={activeView}
        onNavigate={navigateTo}
        onAdd={() => setShowAddForm(true)}
      />
    </div>
  )
}

function InviteStrip({
  code,
  copied,
  onCopy,
}: {
  code: string
  copied: boolean
  onCopy: () => void | Promise<void>
}) {
  if (!code) {
    return null
  }

  return (
    <div style={inviteStripStyle}>
      <div
        style={{
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: '#777',
            fontSize: 12,
            marginBottom: 3,
          }}
        >
          Код для друга
        </div>

        <div
          style={{
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '0.08em',
          }}
        >
          {code}
        </div>
      </div>

      <button
        onClick={() => void onCopy()}
        style={copyInviteButtonStyle}
      >
        {copied ? 'Скопировано ✓' : 'Скопировать'}
      </button>
    </div>
  )
}

function UserBar({
  email,
  displayName,
  groupName,
  canEditGroup,
  busy,
  onOpenProfile,
  onOpenGroup,
  onLogout,
}: {
  email: string
  displayName: string
  groupName: string
  canEditGroup: boolean
  busy: boolean
  onOpenProfile: () => void
  onOpenGroup: () => void
  onLogout: () => void | Promise<void>
}) {
  return (
    <div style={userBarStyle}>
      <div
        style={{
          minWidth: 0,
        }}
      >
        <button
          onClick={onOpenGroup}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 28,
            padding: '4px 6px 4px 0',
            border: 0,
            background: 'transparent',
            color: '#222',
            fontSize: 14,
            fontWeight: 700,
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title="Открыть экран группы"
        >
          👥 {groupName} {canEditGroup ? '✏️' : '›'}
        </button>

        <button
          onClick={onOpenProfile}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 32,
            padding: '4px 6px 4px 0',
            border: 0,
            background: 'transparent',
            marginTop: 3,
            color: '#777',
            fontSize: 12,
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title="Открыть профиль"
        >
          <span style={{ display: 'block', color: '#333', fontWeight: 600 }}>
            👤 {displayName} ✏️
          </span>
          {displayName !== email && (
            <span style={{ display: 'block', marginTop: 2 }}>{email}</span>
          )}
        </button>
      </div>

      <button
        onClick={() => void onLogout()}
        disabled={busy}
        style={{
          ...logoutButtonStyle,
          opacity: busy ? 0.5 : 1,
        }}
      >
        Выйти
      </button>
    </div>
  )
}

function CalibrationEventCard({ event }: { event: DiscoveryEvent }) {
  const dateLabel = event.starts_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(event.starts_at))
    : 'Дата уточняется'

  return (
    <article style={discoveryCardStyle}>
      {event.image_url && (
        <img src={event.image_url} alt="" style={discoveryImageStyle} />
      )}
      <div style={discoveryCardBodyStyle}>
        <h2 style={discoveryCardTitleStyle}>{event.title}</h2>
        <div style={discoveryMetaStyle}>🗓 {dateLabel}</div>
        {event.place_name && (
          <div style={discoveryMetaStyle}>📍 {event.place_name}</div>
        )}
        <div style={discoveryPriceStyle}>
          {event.is_free ? 'Бесплатно' : event.price || 'Цена не указана'}
        </div>
        {event.description && (
          <p style={discoveryDescriptionStyle}>{event.description}</p>
        )}
      </div>
    </article>
  )
}

function DiscoveryEventCard({
  event,
  reaction,
  reasons,
  feedbackBusy,
  planBusy,
  alreadyAdded,
  onReaction,
  onAddToPlans,
}: {
  event: DiscoveryEvent
  reaction?: EventReaction
  reasons?: string[]
  feedbackBusy: boolean
  planBusy: boolean
  alreadyAdded: boolean
  onReaction: (reaction: EventReaction) => void
  onAddToPlans: () => void
}) {
  const dateLabel = event.starts_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(event.starts_at))
    : 'Дата уточняется'

  return (
    <article style={discoveryCardStyle}>
      {event.image_url && (
        <img src={event.image_url} alt="" style={discoveryImageStyle} />
      )}
      <div style={discoveryCardBodyStyle}>
        {reaction === 'not_interested' && (
          <div style={discoveryHiddenBadgeStyle}>👎 Не моё</div>
        )}
        <h2 style={discoveryCardTitleStyle}>{event.title}</h2>
        <div style={discoveryMetaStyle}>🗓 {dateLabel}</div>
        {event.place_name && (
          <div style={discoveryMetaStyle}>📍 {event.place_name}</div>
        )}
        {event.address && (
          <div style={discoveryAddressStyle}>{event.address}</div>
        )}
        <div style={discoveryPriceStyle}>
          {event.is_free ? 'Бесплатно' : event.price || 'Цена не указана'}
          {event.age_restriction ? ` · ${event.age_restriction}` : ''}
        </div>
        {event.description && (
          <p style={discoveryDescriptionStyle}>{event.description}</p>
        )}
        {reasons && reasons.length > 0 && (
          <div style={recommendationReasonsStyle}>
            <div style={recommendationReasonsTitleStyle}>
              ✨ Почему вам подходит
            </div>
            {reasons.slice(0, 2).map((reason) => (
              <div key={reason} style={recommendationReasonStyle}>
                {reason}
              </div>
            ))}
          </div>
        )}
        <div style={discoveryReactionListStyle}>
          {([
            ['interested', '❤️ Интересно'],
            ['not_interested', '👎 Не моё'],
            ['wishlist', '💛 Желаемое'],
          ] as const).map(([value, label]) => {
            const selected = reaction === value

            return (
              <button
                key={value}
                onClick={() => onReaction(value)}
                disabled={feedbackBusy}
                aria-pressed={selected}
                style={{
                  ...discoveryReactionButtonStyle,
                  ...(selected ? discoveryReactionSelectedStyle : {}),
                  opacity: feedbackBusy ? 0.6 : 1,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button
          onClick={onAddToPlans}
          disabled={alreadyAdded || planBusy}
          style={{
            ...discoveryAddPlanButtonStyle,
            opacity: alreadyAdded || planBusy ? 0.65 : 1,
          }}
        >
          {alreadyAdded
            ? '✓ Уже в планах'
            : planBusy
              ? 'Добавляю…'
              : '➕ Добавить в планы'}
        </button>
        <a
          href={event.source_url}
          target="_blank"
          rel="noreferrer"
          style={discoveryDetailsLinkStyle}
        >
          Подробнее
        </a>
      </div>
    </article>
  )
}

function CalendarEventCard({
  event,
  plan,
  onOpenPlan,
  onEdit,
}: {
  event: PlanEvent
  plan: Plan
  onOpenPlan: () => void
  onEdit: () => void
}) {
  const plannedAt = new Date(event.planned_at)
  const typeLabel = plan.event_catalog_id
    ? 'Мероприятие'
    : plan.place_catalog_id
      ? plan.type
      : plan.type

  return (
    <article style={calendarEventCardStyle}>
      <button type="button" onClick={onOpenPlan} style={calendarEventOpenStyle}>
        <div style={calendarEventTimeStyle}>
          {plannedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={calendarEventTypeStyle}>{typeLabel}</div>
        <h3 style={calendarEventTitleStyle}>{plan.title}</h3>
        {plan.address && <div style={calendarEventMetaStyle}>📍 {plan.address}</div>}
        {event.comment && <div style={calendarEventMetaStyle}>💬 {event.comment}</div>}
      </button>
      <button type="button" onClick={onEdit} style={calendarEditButtonStyle}>
        ✏️ Изменить
      </button>
    </article>
  )
}

function PlaceCard({
  place,
  reaction,
  reasons,
  feedbackBusy,
  planBusy,
  alreadyAdded,
  onReaction,
  onAddToPlans,
}: {
  place: DiscoveredPlace
  reaction?: PlaceReaction
  reasons?: string[]
  feedbackBusy: boolean
  planBusy: boolean
  alreadyAdded: boolean
  onReaction: (reaction: PlaceReaction) => void
  onAddToPlans: () => void
}) {
  const displayCategories = displayCategoryValues(place.categories)
  const displayCuisine = displayCategoryValues(place.cuisine)
  const kindLabel = place.kind === 'restaurant'
    ? 'Ресторан'
    : place.kind === 'cafe'
      ? 'Кафе'
      : 'Бар'
  const sourceName = place.source === 'foursquare'
    ? 'Foursquare'
    : place.source
  const phoneHref = place.phone
    ? `tel:${place.phone.replace(/[^+\d]/g, '')}`
    : null
  const instagramHref = place.instagram
    ? place.instagram.startsWith('http')
      ? place.instagram
      : `https://www.instagram.com/${place.instagram.replace(/^@/, '')}`
    : null
  const twitterHref = place.twitter
    ? place.twitter.startsWith('http')
      ? place.twitter
      : `https://x.com/${place.twitter.replace(/^@/, '')}`
    : null

  return (
    <article style={placeCardStyle}>
      {reaction === 'not_interested' && (
        <div style={discoveryHiddenBadgeStyle}>👎 Не моё</div>
      )}
      <h2 style={discoveryCardTitleStyle}>{place.name}</h2>
      <div style={placeDetailStyle}>{kindLabel}</div>

      {displayCategories.length > 0 && (
        <div style={placeTagListStyle}>
          {displayCategories.map((category) => (
            <span key={category} style={placeTagStyle}>{category}</span>
          ))}
        </div>
      )}

      {displayCuisine.length > 0 && (
        <div style={placeDetailStyle}>
          <strong>Кухня:</strong> {displayCuisine.join(', ')}
        </div>
      )}
      {place.address && (
        <div style={placeDetailStyle}>📍 {place.address}</div>
      )}
      {place.distance_meters !== null && (
        <div style={placeDetailStyle}>
          📏 {place.distance_meters < 1000
            ? `${Math.round(place.distance_meters)} м`
            : `${(place.distance_meters / 1000).toFixed(1)} км`}
        </div>
      )}
      {place.chain_name && (
        <div style={placeDetailStyle}>Сеть: {place.chain_name}</div>
      )}
      {place.website && (
        <a
          href={place.website}
          target="_blank"
          rel="noreferrer"
          style={placeLinkStyle}
        >
          Сайт
        </a>
      )}
      {place.phone && phoneHref && (
        <a href={phoneHref} style={placeLinkStyle}>{place.phone}</a>
      )}
      {place.email && (
        <a href={`mailto:${place.email}`} style={placeLinkStyle}>{place.email}</a>
      )}
      {place.instagram && instagramHref && (
        <a
          href={instagramHref}
          target="_blank"
          rel="noreferrer"
          style={placeLinkStyle}
        >
          Instagram
        </a>
      )}
      {place.twitter && twitterHref && (
        <a
          href={twitterHref}
          target="_blank"
          rel="noreferrer"
          style={placeLinkStyle}
        >
          X / Twitter
        </a>
      )}

      {reasons && reasons.length > 0 && (
        <div style={recommendationReasonsStyle}>
          <div style={recommendationReasonsTitleStyle}>✨ Почему вам подходит</div>
          {reasons.slice(0, 2).map((reason) => (
            <div key={reason} style={recommendationReasonStyle}>{reason}</div>
          ))}
        </div>
      )}
      {place.source_url && (
        <a
          href={place.source_url}
          target="_blank"
          rel="noreferrer"
          style={placeLinkStyle}
        >
          Подробнее в источнике
        </a>
      )}

      {place.catalog_id && (
        <>
          <div style={discoveryReactionListStyle}>
            {([
              ['interested', '👍 Интересно'],
              ['not_interested', '👎 Не моё'],
              ['wishlist', '💛 Хочу сходить'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onReaction(value)}
                disabled={feedbackBusy}
                aria-pressed={reaction === value}
                style={{
                  ...discoveryReactionButtonStyle,
                  ...(reaction === value ? discoveryReactionSelectedStyle : {}),
                  opacity: feedbackBusy ? 0.6 : 1,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onAddToPlans}
            disabled={alreadyAdded || planBusy}
            style={{
              ...discoveryAddPlanButtonStyle,
              opacity: alreadyAdded || planBusy ? 0.65 : 1,
            }}
          >
            {alreadyAdded
              ? '✓ Уже в планах'
              : planBusy
                ? 'Добавляю…'
                : '➕ Добавить в планы'}
          </button>
        </>
      )}

      <div style={placeSourceStyle}>Источник: {sourceName}</div>
    </article>
  )
}

function BottomNavigation({
  activeView,
  onNavigate,
  onAdd,
}: {
  activeView: AppView
  onNavigate: (view: AppView) => void
  onAdd: () => void
}) {
  return (
    <div style={bottomNavStyle}>
      <button
        onClick={() => onNavigate('home')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'home' ? 700 : 400,
        }}
      >
        📋 Мои планы
      </button>
      <button
        onClick={() => onNavigate('discovery')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'discovery' ? 700 : 400,
        }}
      >
        🔎 Афиша
      </button>
      <button
        onClick={() => onNavigate('recommendations')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'recommendations' ? 700 : 400,
        }}
      >
        ✨ Для меня
      </button>
      <button
        onClick={() => onNavigate('places')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'places' ? 700 : 400,
        }}
      >
        🍽 Места
      </button>
      <button
        onClick={() => onNavigate('calendar')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'calendar' ? 700 : 400,
        }}
      >
        📅 Календарь
      </button>
      <button
        onClick={() => onNavigate('ranking')}
        style={{
          ...navButtonStyle,
          fontWeight: activeView === 'ranking' ? 700 : 400,
        }}
      >
        🏆 Рейтинг
      </button>
      <button onClick={onAdd} style={navButtonStyle}>
        ➕ Добавить
      </button>
    </div>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div
      style={{
        padding: '13px 0',
        borderBottom: '1px solid #eee',
      }}
    >
      <div
        style={{
          color: '#777',
          fontSize: 13,
          marginBottom: 4,
        }}
      >
        {label}
      </div>

      <div>{value}</div>
    </div>
  )
}

const pageTitleStyle = {
  margin: '0 0 12px',
  fontSize: 30,
  lineHeight: 1.15,
  fontWeight: 700,
  letterSpacing: '-0.02em',
}

const pageContainerStyle = {
  maxWidth: 520,
  margin: '0 auto',
  padding: '28px 18px 96px',
  fontFamily: 'Arial, sans-serif',
  color: '#222',
}

const pageDescriptionStyle = {
  marginTop: 0,
  marginBottom: 24,
  color: '#777',
  fontSize: 16,
  lineHeight: 1.5,
}

const contentCardStyle = {
  padding: 18,
  border: '1px solid #e5e5e5',
  borderRadius: 16,
  background: 'white',
}

const readOnlyInputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '13px 14px',
  marginTop: 8,
  borderRadius: 10,
  border: '1px solid #ddd',
  fontSize: 16,
  fontFamily: 'inherit',
  background: '#f5f5f5',
  color: '#666',
}

const infoLabelStyle = {
  color: '#777',
  fontSize: 13,
  marginBottom: 8,
}

const groupInviteRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const groupNameSectionStyle = {
  paddingBottom: 13,
  borderBottom: '1px solid #eee',
}

const groupNameRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const groupNameActionsStyle = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
}

const smallPrimaryButtonStyle = {
  padding: '8px 12px',
  border: 0,
  borderRadius: 9,
  background: '#222',
  color: 'white',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const inlineErrorStyle = {
  marginTop: 9,
  color: '#9b1c1c',
  fontSize: 13,
  lineHeight: 1.4,
}

const memberCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: 15,
  border: '1px solid #e5e5e5',
  borderRadius: 14,
  background: 'white',
}

const memberNameStyle = {
  fontSize: 15,
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const memberEmailStyle = {
  marginTop: 4,
  color: '#777',
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const roleBadgeStyle = {
  flexShrink: 0,
  padding: '5px 8px',
  borderRadius: 999,
  background: '#f2f2f2',
  color: '#555',
  fontSize: 12,
  fontWeight: 600,
}

const discoveryPeriodStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
  marginTop: 16,
}

const discoveryPeriodButtonStyle = {
  padding: '10px 6px',
  border: '1px solid #ddd',
  borderRadius: 10,
  background: 'white',
  color: '#555',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const discoveryPeriodActiveStyle = {
  borderColor: '#222',
  background: '#222',
  color: 'white',
  fontWeight: 700,
}

const discoveryHiddenToggleStyle = {
  display: 'block',
  margin: '14px auto 0',
  padding: '7px 11px',
  border: '1px solid #ddd',
  borderRadius: 999,
  background: 'white',
  color: '#555',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const discoveryHiddenToggleActiveStyle = {
  borderColor: '#d8b4b4',
  background: '#fff6f6',
  color: '#8a3434',
}

const discoveryListStyle = {
  display: 'grid',
  gap: 14,
  marginTop: 20,
}

const placeKindSelectorStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 7,
}

const placeKindButtonStyle = {
  minHeight: 46,
  padding: '8px 5px',
  border: '1px solid #ddd',
  borderRadius: 11,
  background: 'white',
  color: '#444',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const placeKindButtonActiveStyle = {
  borderColor: '#222',
  background: '#222',
  color: 'white',
  fontWeight: 700,
}

const placeListStyle = {
  display: 'grid',
  gap: 14,
  marginTop: 20,
}

const placeCardStyle = {
  padding: 17,
  border: '1px solid #e5e5e5',
  borderRadius: 16,
  background: 'white',
}

const placeTagListStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 6,
  marginBottom: 12,
}

const placeTagStyle = {
  padding: '4px 8px',
  borderRadius: 999,
  background: '#f3f3f3',
  color: '#555',
  fontSize: 12,
}

const placeDetailStyle = {
  marginTop: 8,
  color: '#444',
  fontSize: 14,
  lineHeight: 1.45,
}

const placeLinkStyle = {
  display: 'inline-block',
  marginTop: 12,
  marginRight: 14,
  color: '#315f9b',
  fontSize: 14,
  textDecoration: 'none',
}

const placeSourceStyle = {
  marginTop: 15,
  paddingTop: 11,
  borderTop: '1px solid #eee',
  color: '#888',
  fontSize: 12,
}

const discoveryCardStyle = {
  overflow: 'hidden',
  border: '1px solid #e5e5e5',
  borderRadius: 16,
  background: 'white',
}

const discoveryImageStyle = {
  display: 'block',
  width: '100%',
  height: 190,
  objectFit: 'cover' as const,
  background: '#f2f2f2',
}

const discoveryCardBodyStyle = {
  padding: 16,
}

const discoveryHiddenBadgeStyle = {
  display: 'inline-block',
  marginBottom: 9,
  padding: '5px 9px',
  borderRadius: 999,
  background: '#fff0f0',
  color: '#9b2c2c',
  fontSize: 13,
  fontWeight: 700,
}

const discoveryCardTitleStyle = {
  margin: '0 0 10px',
  fontSize: 19,
  lineHeight: 1.3,
}

const discoveryMetaStyle = {
  marginTop: 5,
  color: '#444',
  fontSize: 14,
  lineHeight: 1.4,
}

const discoveryAddressStyle = {
  marginTop: 3,
  color: '#777',
  fontSize: 13,
  lineHeight: 1.4,
}

const discoveryPriceStyle = {
  marginTop: 10,
  color: '#355b3b',
  fontSize: 14,
  fontWeight: 700,
}

const discoveryDescriptionStyle = {
  display: '-webkit-box',
  margin: '12px 0 0',
  overflow: 'hidden',
  color: '#666',
  fontSize: 14,
  lineHeight: 1.5,
  WebkitBoxOrient: 'vertical' as const,
  WebkitLineClamp: 3,
}

const recommendationHintStyle = {
  marginBottom: 16,
  padding: '12px 14px',
  borderRadius: 12,
  background: '#f5f3ff',
  color: '#5b4b8a',
  fontSize: 14,
  lineHeight: 1.45,
}

const recommendationReasonsStyle = {
  marginTop: 14,
  padding: 12,
  borderRadius: 12,
  background: '#faf8ff',
  border: '1px solid #ece7ff',
}

const recommendationReasonsTitleStyle = {
  marginBottom: 7,
  color: '#5b4b8a',
  fontSize: 14,
  fontWeight: 700,
}

const recommendationReasonStyle = {
  marginTop: 4,
  color: '#555',
  fontSize: 13,
  lineHeight: 1.4,
}

const discoveryDetailsLinkStyle = {
  display: 'inline-block',
  marginTop: 14,
  color: '#222',
  fontSize: 14,
  fontWeight: 700,
}

const discoveryReactionListStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 7,
  marginTop: 14,
}

const discoveryReactionButtonStyle = {
  minWidth: 0,
  padding: '9px 5px',
  border: '1px solid #ddd',
  borderRadius: 10,
  background: 'white',
  color: '#444',
  fontSize: 12,
  lineHeight: 1.25,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const discoveryReactionSelectedStyle = {
  borderColor: '#222',
  background: '#f1f1f1',
  color: '#111',
  fontWeight: 700,
}

const discoveryAddPlanButtonStyle = {
  width: '100%',
  marginTop: 12,
  padding: '11px 10px',
  border: '1px solid #d8d8d8',
  borderRadius: 10,
  background: '#f7f7f7',
  color: '#222',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const discoverySourceStyle = {
  marginTop: 20,
  color: '#888',
  fontSize: 12,
  textAlign: 'center' as const,
}

const sectionTitleStyle = {
  margin: '0 0 12px',
  fontSize: 22,
  lineHeight: 1.25,
  fontWeight: 700,
}

const sheetTitleStyle = {
  margin: '0 0 18px',
  fontSize: 24,
  lineHeight: 1.2,
  fontWeight: 700,
}

const authPageStyle = {
  minHeight: '100vh',
  boxSizing: 'border-box' as const,
  padding: '24px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f7f7f7',
  fontFamily: 'Arial, sans-serif',
  color: '#222',
}

const authCardStyle = {
  width: '100%',
  maxWidth: 420,
  boxSizing: 'border-box' as const,
  padding: '26px 24px 28px',
  border: '1px solid #e5e5e5',
  borderRadius: 22,
  background: 'white',
}

const authTabsStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
  padding: 4,
  marginBottom: 18,
  borderRadius: 12,
  background: '#fafafa',
}

const authTabButtonStyle = {
  padding: 10,
  border: 0,
  borderRadius: 9,
  color: '#222',
  fontSize: 15,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const authErrorStyle = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  background: '#fff1f1',
  color: '#9b1c1c',
  fontSize: 14,
  lineHeight: 1.4,
}

const authSuccessStyle = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  background: '#f2f8f2',
  color: '#2f6b3a',
  fontSize: 14,
  lineHeight: 1.4,
}

const workspaceSectionStyle = {
  padding: 18,
  border: '1px solid #e8e8e8',
  borderRadius: 16,
  background: '#fcfcfc',
}

const workspaceSectionTitleStyle = {
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1.3,
}

const workspaceDividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '22px 0',
}

const workspaceDividerLineStyle = {
  height: 1,
  flex: 1,
  background: '#e5e5e5',
}

const workspaceDividerTextStyle = {
  color: '#999',
  fontSize: 13,
}

const inviteStripStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  margin: '-8px 0 26px',
  padding: '12px 14px',
  border: '1px solid #e5e5e5',
  borderRadius: 14,
  background: '#fafafa',
}

const copyInviteButtonStyle = {
  flexShrink: 0,
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 9,
  background: 'white',
  color: '#333',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const workspaceUserRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 28,
  paddingBottom: 16,
  borderBottom: '1px solid #eee',
}

const userBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 26,
  paddingBottom: 16,
  borderBottom: '1px solid #eee',
}

const logoutButtonStyle = {
  flexShrink: 0,
  padding: '7px 10px',
  border: '1px solid #ddd',
  borderRadius: 9,
  background: 'white',
  color: '#555',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const rankingCardStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxSizing: 'border-box' as const,
  padding: 15,
  border: '1px solid #e5e5e5',
  borderRadius: 16,
  background: 'white',
  color: '#222',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const rankingNumberStyle = {
  width: 30,
  height: 30,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 999,
  background: '#f2f2f2',
  fontSize: 14,
  fontWeight: 700,
}

const emptyRankingStyle = {
  padding: 18,
  border: '1px dashed #ddd',
  borderRadius: 16,
  color: '#777',
  textAlign: 'center' as const,
}

const calendarModeStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  marginBottom: 20,
}

const calendarModeButtonStyle = {
  padding: '11px 8px',
  border: '1px solid #ddd',
  borderRadius: 11,
  background: 'white',
  color: '#555',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const calendarModeButtonActiveStyle = {
  borderColor: '#222',
  background: '#222',
  color: 'white',
  fontWeight: 700,
}

const calendarEmptyStyle = {
  padding: '30px 20px',
  border: '1px dashed #d8d8d8',
  borderRadius: 18,
  textAlign: 'center' as const,
  background: '#fafafa',
}

const calendarMonthHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: '42px 1fr 42px',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  textAlign: 'center' as const,
  fontSize: 18,
  textTransform: 'capitalize' as const,
}

const calendarArrowStyle = {
  width: 42,
  height: 42,
  border: '1px solid #ddd',
  borderRadius: 12,
  background: 'white',
  color: '#222',
  fontSize: 26,
  cursor: 'pointer',
}

const calendarGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 4,
}

const calendarWeekdayStyle = {
  padding: '5px 0 7px',
  color: '#888',
  fontSize: 11,
  textAlign: 'center' as const,
}

const calendarDayStyle = {
  minWidth: 0,
  minHeight: 52,
  padding: '6px 2px',
  border: '1px solid transparent',
  borderRadius: 10,
  background: '#fafafa',
  color: '#333',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const calendarDaySelectedStyle = {
  borderColor: '#222',
  background: '#f0f0f0',
}

const calendarTodayStyle = {
  boxShadow: 'inset 0 0 0 1px #6b5ca5',
  fontWeight: 700,
}

const calendarMarkerStyle = {
  display: 'block',
  marginTop: 4,
  color: '#6b5ca5',
  fontSize: 11,
  fontWeight: 700,
}

const calendarEventListStyle = {
  display: 'grid',
  gap: 10,
}

const calendarListDateStyle = {
  margin: '0 0 10px',
  fontSize: 18,
  textTransform: 'capitalize' as const,
}

const calendarEventCardStyle = {
  padding: 15,
  border: '1px solid #e5e5e5',
  borderRadius: 15,
  background: 'white',
}

const calendarEventOpenStyle = {
  width: '100%',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: '#222',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const calendarEventTimeStyle = {
  color: '#6b5ca5',
  fontSize: 15,
  fontWeight: 700,
}

const calendarEventTypeStyle = {
  marginTop: 5,
  color: '#777',
  fontSize: 12,
}

const calendarEventTitleStyle = {
  margin: '5px 0 0',
  fontSize: 17,
  lineHeight: 1.3,
}

const calendarEventMetaStyle = {
  marginTop: 7,
  color: '#555',
  fontSize: 13,
  lineHeight: 1.4,
}

const calendarEditButtonStyle = {
  marginTop: 12,
  padding: '7px 10px',
  border: '1px solid #ddd',
  borderRadius: 9,
  background: '#fafafa',
  color: '#444',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
}

const bottomNavStyle = {
  position: 'fixed' as const,
  bottom: 0,
  left: 0,
  right: 0,
  background: 'white',
  borderTop: '1px solid #eee',
  padding: '12px 10px calc(12px + env(safe-area-inset-bottom))',
  display: 'flex',
  justifyContent: 'flex-start',
  gap: 4,
  overflowX: 'auto' as const,
  WebkitOverflowScrolling: 'touch' as const,
  zIndex: 10,
}

const navButtonStyle = {
  flex: '0 0 78px',
  border: 0,
  background: 'transparent',
  color: '#222',
  fontSize: 13,
  cursor: 'pointer',
  padding: '2px 1px',
  whiteSpace: 'nowrap' as const,
  fontFamily: 'inherit',
}

const fieldLabelStyle = {
  display: 'block',
  marginTop: 20,
  fontSize: 14,
  fontWeight: 600,
  color: '#555',
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '13px 14px',
  marginTop: 8,
  borderRadius: 10,
  border: '1px solid #ddd',
  fontSize: 16,
  fontFamily: 'inherit',
}

const textareaStyle = {
  ...inputStyle,
  minHeight: 150,
  resize: 'vertical' as const,
  lineHeight: 1.5,
}

const calibrationProgressStyle = {
  marginBottom: 14,
  color: '#666',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'center' as const,
}

const calibrationActionsStyle = {
  display: 'grid',
  gap: 10,
  marginTop: 16,
}

const preferencesTextStyle = {
  marginTop: 8,
  whiteSpace: 'pre-wrap' as const,
  lineHeight: 1.5,
  color: '#333',
}

const preferencesCityStyle = {
  marginTop: 10,
  color: '#666',
  fontSize: 14,
}

const mainButtonStyle = {
  width: '100%',
  padding: 15,
  border: 0,
  borderRadius: 12,
  background: '#222',
  color: 'white',
  fontSize: 16,
  cursor: 'pointer',
}

const secondaryButtonStyle = {
  width: '100%',
  padding: 14,
  border: '1px solid #ddd',
  borderRadius: 12,
  background: 'white',
  color: '#222',
  fontSize: 16,
  cursor: 'pointer',
}

const factButtonStyle = {
  width: '100%',
  padding: 12,
  border: '1px solid #d8d8d8',
  borderRadius: 10,
  background: '#f7f7f7',
  color: '#222',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
}

const desireButtonStyle = {
  width: '100%',
  padding: 14,
  border: '1px solid #eadca9',
  borderRadius: 12,
  background: '#fff9e8',
  color: '#6f5600',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
}

const dangerButtonStyle = {
  width: '100%',
  padding: 14,
  border: '1px solid #f1b7b7',
  borderRadius: 12,
  background: '#fff5f5',
  color: '#b42318',
  fontSize: 16,
  cursor: 'pointer',
}

const cancelButtonStyle = {
  width: '100%',
  padding: 13,
  border: 0,
  background: 'transparent',
  fontSize: 15,
  cursor: 'pointer',
  marginTop: 5,
}

const overlayStyle = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 20,
}

const overlayPanelStyle = {
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflowY: 'auto' as const,
  background: 'white',
  borderRadius: '24px 24px 0 0',
  padding: '26px 20px 30px',
  boxSizing: 'border-box' as const,
}

export default App

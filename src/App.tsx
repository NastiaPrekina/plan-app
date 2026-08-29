import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Plan = {
  id: string
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

type AppView = 'home' | 'ranking' | 'group' | 'profile'
type AuthMode = 'login' | 'register'

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

type GroupIntegration = {
  id: string
  group_id: string
  provider: 'google_sheets'
  spreadsheet_id: string
  sheet_name: string
  created_by: string
  created_at?: string
  updated_at?: string
}

type GoogleSheetValidation = {
  status: 'passed' | 'warning' | 'failed'
  valid: boolean
  missingHeaders: string[]
  warnings: string[]
  technicalColumnMissing: boolean
}

type GoogleSheetCheckResult = {
  serviceAccountEmail: string
  spreadsheetId: string
  spreadsheetTitle: string
  sheetName: string
  headers: string[]
  validation: GoogleSheetValidation
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
  const [googleSheetIntegration, setGoogleSheetIntegration] =
    useState<GroupIntegration | null>(null)
  const [googleSheetLoading, setGoogleSheetLoading] = useState(false)
  const [googleSheetBusy, setGoogleSheetBusy] = useState(false)
  const [googleSheetFormOpen, setGoogleSheetFormOpen] = useState(false)
  const [googleSheetUrl, setGoogleSheetUrl] = useState('')
  const [googleServiceAccountEmail, setGoogleServiceAccountEmail] = useState('')
  const [googleSheetCheck, setGoogleSheetCheck] =
    useState<GoogleSheetCheckResult | null>(null)
  const [googleSheetError, setGoogleSheetError] = useState('')

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
      setGoogleSheetIntegration(null)
      setGoogleSheetFormOpen(false)
      setGoogleSheetCheck(null)
      setGoogleSheetError('')
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
      loadGoogleSheetIntegration(loadedGroup.id),
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
      loadGoogleSheetIntegration(createdGroup.id),
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
      loadGoogleSheetIntegration(joinedGroup.id),
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

  async function loadGoogleSheetIntegration(groupId: string) {
    setGoogleSheetLoading(true)

    const { data, error } = await supabase
      .from('group_integrations')
      .select('*')
      .eq('group_id', groupId)
      .eq('provider', 'google_sheets')
      .maybeSingle()

    if (error) {
      console.error('Ошибка загрузки интеграции Google Sheets:', error)
      setGoogleSheetError('Не удалось загрузить подключение Google Таблицы.')
      setGoogleSheetLoading(false)
      return
    }

    setGoogleSheetIntegration(
      data
        ? {
            id: String(data.id),
            group_id: String(data.group_id),
            provider: 'google_sheets',
            spreadsheet_id: String(data.spreadsheet_id),
            sheet_name: String(data.sheet_name ?? ''),
            created_by: String(data.created_by),
            created_at: data.created_at ?? undefined,
            updated_at: data.updated_at ?? undefined,
          }
        : null
    )
    setGoogleSheetError('')
    setGoogleSheetLoading(false)
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

  async function loadGoogleServiceAccountEmail() {
    if (!activeGroup || activeGroupRole !== 'owner') {
      return
    }

    const { data, error } = await supabase.functions.invoke(
      'google-sheets-integration',
      {
        body: {
          action: 'service_account_info',
          group_id: activeGroup.id,
        },
      }
    )

    if (error) {
      setGoogleSheetError(await getEdgeFunctionErrorMessage(error))
      return
    }

    setGoogleServiceAccountEmail(String(data.serviceAccountEmail ?? ''))
  }

  async function openGoogleSheetForm() {
    if (!activeGroup || activeGroupRole !== 'owner') {
      return
    }

    setGoogleSheetFormOpen(true)
    setGoogleSheetCheck(null)
    setGoogleSheetError('')
    setGoogleSheetUrl(
      googleSheetIntegration
        ? `https://docs.google.com/spreadsheets/d/${googleSheetIntegration.spreadsheet_id}/edit`
        : ''
    )

    if (!googleServiceAccountEmail) {
      await loadGoogleServiceAccountEmail()
    }
  }

  function closeGoogleSheetForm() {
    if (googleSheetBusy) {
      return
    }

    setGoogleSheetFormOpen(false)
    setGoogleSheetCheck(null)
    setGoogleSheetError('')
  }

  async function checkGoogleSheet(urlOverride?: string) {
    if (!activeGroup || activeGroupRole !== 'owner') {
      return
    }

    const spreadsheetUrl = (urlOverride ?? googleSheetUrl).trim()

    if (!spreadsheetUrl) {
      setGoogleSheetError('Вставьте ссылку на Google Таблицу.')
      return
    }

    setGoogleSheetBusy(true)
    setGoogleSheetError('')
    setGoogleSheetCheck(null)

    const { data, error } = await supabase.functions.invoke(
      'google-sheets-integration',
      {
        body: {
          action: 'validate',
          group_id: activeGroup.id,
          spreadsheet_url: spreadsheetUrl,
        },
      }
    )

    if (error) {
      setGoogleSheetError(await getEdgeFunctionErrorMessage(error))
      setGoogleSheetBusy(false)
      return
    }

    const result = data as GoogleSheetCheckResult
    setGoogleServiceAccountEmail(result.serviceAccountEmail)
    setGoogleSheetCheck(result)
    setGoogleSheetBusy(false)
  }

  async function saveGoogleSheetIntegration() {
    if (
      !activeGroup ||
      !session ||
      activeGroupRole !== 'owner' ||
      !googleSheetCheck?.validation.valid
    ) {
      return
    }

    setGoogleSheetBusy(true)
    setGoogleSheetError('')

    const integrationValues = {
      group_id: activeGroup.id,
      provider: 'google_sheets',
      spreadsheet_id: googleSheetCheck.spreadsheetId,
      sheet_name: googleSheetCheck.sheetName,
    }
    const query = googleSheetIntegration
      ? supabase
          .from('group_integrations')
          .update(integrationValues)
          .eq('id', googleSheetIntegration.id)
      : supabase
          .from('group_integrations')
          .insert({
            ...integrationValues,
            created_by: session.user.id,
          })
    const { data, error } = await query.select().single()

    if (error) {
      console.error('Ошибка сохранения интеграции Google Sheets:', error)
      setGoogleSheetError('Не удалось сохранить подключение Google Таблицы.')
      setGoogleSheetBusy(false)
      return
    }

    setGoogleSheetIntegration({
      id: String(data.id),
      group_id: String(data.group_id),
      provider: 'google_sheets',
      spreadsheet_id: String(data.spreadsheet_id),
      sheet_name: String(data.sheet_name ?? ''),
      created_by: String(data.created_by),
      created_at: data.created_at ?? undefined,
      updated_at: data.updated_at ?? undefined,
    })
    setGoogleSheetFormOpen(false)
    setGoogleSheetCheck(null)
    setGoogleSheetBusy(false)
  }

  async function disconnectGoogleSheet() {
    if (
      !activeGroup ||
      activeGroupRole !== 'owner' ||
      !googleSheetIntegration
    ) {
      return
    }

    const confirmed = window.confirm('Отключить Google Таблицу от этой группы?')

    if (!confirmed) {
      return
    }

    setGoogleSheetBusy(true)
    setGoogleSheetError('')

    const { error } = await supabase
      .from('group_integrations')
      .delete()
      .eq('id', googleSheetIntegration.id)
      .eq('group_id', activeGroup.id)

    if (error) {
      console.error('Ошибка отключения Google Sheets:', error)
      setGoogleSheetError('Не удалось отключить Google Таблицу.')
      setGoogleSheetBusy(false)
      return
    }

    setGoogleSheetIntegration(null)
    setGoogleSheetFormOpen(false)
    setGoogleSheetCheck(null)
    setGoogleSheetUrl('')
    setGoogleSheetBusy(false)
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

  if (activeView === 'profile') {
    return (
      <div style={pageContainerStyle}>
        <UserBar
          email={userEmail}
          displayName={userDisplayName}
          groupName={activeGroup.name}
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

        <BottomNavigation
          activeView={activeView}
          onNavigate={setActiveView}
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
          Google Таблица
        </h2>

        <div style={contentCardStyle}>
          {googleSheetLoading && (
            <div style={integrationMutedTextStyle}>Проверяю подключение…</div>
          )}

          {!googleSheetLoading && !googleSheetIntegration && !googleSheetFormOpen && (
            <>
              <div style={integrationMutedTextStyle}>
                Google Таблица пока не подключена к этой группе.
              </div>
              {activeGroupRole === 'owner' && (
                <button
                  onClick={() => void openGoogleSheetForm()}
                  style={{ ...secondaryButtonStyle, marginTop: 16 }}
                >
                  Подключить Google Таблицу
                </button>
              )}
            </>
          )}

          {googleSheetFormOpen && activeGroupRole === 'owner' && (
            <>
              <div style={integrationInstructionStyle}>
                Предоставьте этому service account доступ Editor к таблице:
                <strong style={serviceAccountEmailStyle}>
                  {googleServiceAccountEmail || 'Загружаю email…'}
                </strong>
              </div>

              <label style={fieldLabelStyle}>Ссылка на Google Таблицу</label>
              <input
                value={googleSheetUrl}
                onChange={(event) => {
                  setGoogleSheetUrl(event.target.value)
                  setGoogleSheetCheck(null)
                  setGoogleSheetError('')
                }}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                disabled={googleSheetBusy}
                style={inputStyle}
              />

              <button
                onClick={() => void checkGoogleSheet()}
                disabled={googleSheetBusy}
                style={{
                  ...secondaryButtonStyle,
                  marginTop: 14,
                  opacity: googleSheetBusy ? 0.6 : 1,
                }}
              >
                {googleSheetBusy ? 'Проверяю…' : 'Проверить подключение'}
              </button>

              {googleSheetCheck && (
                <SheetValidationResult result={googleSheetCheck} />
              )}

              {googleSheetCheck?.validation.valid && (
                <button
                  onClick={() => void saveGoogleSheetIntegration()}
                  disabled={googleSheetBusy}
                  style={{
                    ...mainButtonStyle,
                    marginTop: 14,
                    opacity: googleSheetBusy ? 0.6 : 1,
                  }}
                >
                  {googleSheetBusy ? 'Сохраняю…' : 'Сохранить подключение'}
                </button>
              )}

              <button
                onClick={closeGoogleSheetForm}
                disabled={googleSheetBusy}
                style={cancelButtonStyle}
              >
                Отмена
              </button>
            </>
          )}

          {!googleSheetLoading && googleSheetIntegration && !googleSheetFormOpen && (
            <>
              <div style={integrationConnectedStyle}>
                ✅ Google Таблица подключена
              </div>
              <div style={integrationDetailsStyle}>
                <div>Вкладка: {googleSheetIntegration.sheet_name || 'не указана'}</div>
                <div>ID: {googleSheetIntegration.spreadsheet_id}</div>
              </div>

              {googleSheetCheck && (
                <SheetValidationResult result={googleSheetCheck} />
              )}

              <button disabled style={disabledSyncButtonStyle}>
                🔄 Обновить из таблицы
                <span style={{ display: 'block', marginTop: 3, fontSize: 11 }}>
                  Будет доступно на следующем этапе
                </span>
              </button>

              {activeGroupRole === 'owner' && (
                <div style={integrationActionsStyle}>
                  <button
                    onClick={() =>
                      void checkGoogleSheet(
                        `https://docs.google.com/spreadsheets/d/${googleSheetIntegration.spreadsheet_id}/edit`
                      )
                    }
                    disabled={googleSheetBusy}
                    style={copyInviteButtonStyle}
                  >
                    {googleSheetBusy ? 'Проверяю…' : 'Проверить снова'}
                  </button>
                  <button
                    onClick={() => void openGoogleSheetForm()}
                    disabled={googleSheetBusy}
                    style={copyInviteButtonStyle}
                  >
                    Изменить таблицу
                  </button>
                  <button
                    onClick={() => void disconnectGoogleSheet()}
                    disabled={googleSheetBusy}
                    style={integrationDisconnectButtonStyle}
                  >
                    Отключить
                  </button>
                </div>
              )}
            </>
          )}

          {googleSheetError && (
            <div style={authErrorStyle}>{googleSheetError}</div>
          )}
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
          onNavigate={setActiveView}
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

        <div style={bottomNavStyle}>
          <button
            onClick={() => setActiveView('home')}
            style={navButtonStyle}
          >
            🏠 Главная
          </button>

          <button
            onClick={() => setActiveView('ranking')}
            style={{
              ...navButtonStyle,
              fontWeight: 700,
            }}
          >
            🏆 Рейтинг
          </button>

          <button
            onClick={() => {
              setActiveView('home')
              setShowAddForm(true)
            }}
            style={navButtonStyle}
          >
            ➕ Добавить
          </button>
        </div>
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
            style={sheetStyle}
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
          <div style={sheetStyle}>
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
          <div style={sheetStyle}>
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
            style={sheetStyle}
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
            style={sheetStyle}
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
            style={sheetStyle}
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

      <div style={bottomNavStyle}>
        <button
          onClick={() => setActiveView('home')}
          style={{
            ...navButtonStyle,
            fontWeight: 700,
          }}
        >
          🏠 Главная
        </button>

        <button
          onClick={() => setActiveView('ranking')}
          style={navButtonStyle}
        >
          🏆 Рейтинг
        </button>

        <button
          onClick={() => setShowAddForm(true)}
          style={navButtonStyle}
        >
          ➕ Добавить
        </button>
      </div>
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
  busy,
  onOpenProfile,
  onOpenGroup,
  onLogout,
}: {
  email: string
  displayName: string
  groupName: string
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
            padding: 0,
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
          title={groupName}
        >
          👥 {groupName}
        </button>

        <button
          onClick={onOpenProfile}
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
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
          title={`${displayName} · ${email}`}
        >
          <span style={{ display: 'block', color: '#333', fontWeight: 600 }}>
            👤 {displayName}
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
        🏠 Главная
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

function SheetValidationResult({ result }: { result: GoogleSheetCheckResult }) {
  const validation = result.validation
  const background =
    validation.status === 'failed'
      ? '#fff1f1'
      : validation.status === 'warning'
        ? '#fff9e8'
        : '#f2f8f2'
  const color = validation.status === 'failed' ? '#9b1c1c' : '#355b3b'

  return (
    <div style={{ ...sheetValidationStyle, background, color }}>
      <div style={{ fontWeight: 700 }}>
        {validation.status === 'failed'
          ? '❌ Структура не прошла проверку'
          : validation.status === 'warning'
            ? '⚠️ Таблица доступна, есть предупреждения'
            : '✅ Структура таблицы подходит'}
      </div>
      <div style={sheetValidationDetailsStyle}>
        <div>Файл: {result.spreadsheetTitle}</div>
        <div>ID: {result.spreadsheetId}</div>
        <div>Вкладка: {result.sheetName}</div>
        <div>Найдено заголовков: {result.headers.length}</div>
      </div>

      {validation.missingHeaders.length > 0 && (
        <div style={{ marginTop: 8 }}>
          Отсутствуют: {validation.missingHeaders.join(', ')}
        </div>
      )}
      {validation.technicalColumnMissing && (
        <div style={{ marginTop: 6 }}>
          technicalColumnMissing: true — столбец _plan_id будет добавлен на
          следующем этапе.
        </div>
      )}
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

const integrationMutedTextStyle = {
  color: '#777',
  fontSize: 14,
  lineHeight: 1.5,
}

const integrationInstructionStyle = {
  padding: 12,
  borderRadius: 10,
  background: '#f7f7f7',
  color: '#555',
  fontSize: 13,
  lineHeight: 1.5,
}

const serviceAccountEmailStyle = {
  display: 'block',
  marginTop: 5,
  color: '#222',
  overflowWrap: 'anywhere' as const,
}

const integrationConnectedStyle = {
  color: '#2f6b3a',
  fontSize: 16,
  fontWeight: 700,
}

const integrationDetailsStyle = {
  display: 'grid',
  gap: 4,
  marginTop: 10,
  color: '#666',
  fontSize: 13,
  overflowWrap: 'anywhere' as const,
}

const integrationActionsStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 8,
  marginTop: 12,
}

const integrationDisconnectButtonStyle = {
  flexShrink: 0,
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 9,
  background: 'white',
  color: '#9b1c1c',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const disabledSyncButtonStyle = {
  width: '100%',
  marginTop: 16,
  padding: '11px 12px',
  border: '1px solid #ddd',
  borderRadius: 10,
  background: '#f4f4f4',
  color: '#888',
  cursor: 'not-allowed',
  fontFamily: 'inherit',
}

const sheetValidationStyle = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.45,
}

const sheetValidationDetailsStyle = {
  display: 'grid',
  gap: 3,
  marginTop: 8,
  overflowWrap: 'anywhere' as const,
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

const bottomNavStyle = {
  position: 'fixed' as const,
  bottom: 0,
  left: 0,
  right: 0,
  background: 'white',
  borderTop: '1px solid #eee',
  padding: '12px 10px calc(12px + env(safe-area-inset-bottom))',
  display: 'flex',
  justifyContent: 'center',
  gap: 24,
  zIndex: 10,
}

const navButtonStyle = {
  border: 0,
  background: 'transparent',
  color: '#222',
  fontSize: 15,
  cursor: 'pointer',
  padding: 0,
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

const sheetStyle = {
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

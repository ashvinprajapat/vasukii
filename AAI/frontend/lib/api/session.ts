import type { User, UserRole } from './schemas'

/**
 * Demo Mode: sign-in and sign-up run entirely in the browser. No credentials are sent to the
 * backend or Supabase; the entered profile is kept in localStorage so a reload stays signed in.
 * This is a frontend demonstration, not real authentication.
 */
export const DEMO_AUTH = true

/**
 * Outside Demo Mode the FastAPI backend authenticates with Supabase Auth bearer tokens returned by
 * /api/auth/login and /api/auth/signup, sent as `Authorization: Bearer <token>`.
 */
export const AUTH_TRANSPORT: 'cookie' | 'bearer' | null = DEMO_AUTH ? null : 'bearer'

const STORAGE_KEY = 'vasukii.session'
const DEMO_ACCOUNTS_KEY = 'vasukii.demo-accounts'

type StoredSession = { accessToken: string | null; refreshToken: string | null; demoUser: User | null }

let cache: StoredSession | null | undefined
const listeners = new Set<() => void>()

function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null
  if (cache !== undefined) return cache
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    const value = parsed as Partial<StoredSession> | null
    const demoUser = value?.demoUser && typeof value.demoUser.id === 'string' ? value.demoUser : null
    const accessToken = typeof value?.accessToken === 'string' ? value.accessToken : null
    cache =
      demoUser || accessToken
        ? { accessToken, refreshToken: typeof value?.refreshToken === 'string' ? value.refreshToken : null, demoUser }
        : null
  } catch {
    cache = null
  }
  return cache
}

function writeSession(session: StoredSession | null) {
  cache = session
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {}
  listeners.forEach((listener) => listener())
}

export function setSession(session: { accessToken: string; refreshToken?: string | null }) {
  writeSession({ accessToken: session.accessToken, refreshToken: session.refreshToken ?? null, demoUser: null })
}

export function getAccessToken() {
  return readSession()?.accessToken ?? null
}

export function getRefreshToken() {
  return readSession()?.refreshToken ?? null
}

export function hasSession() {
  return readSession() !== null
}

export function clearSession() {
  if (typeof window === 'undefined') return
  writeSession(null)
}

type DemoAccount = Pick<User, 'name' | 'role' | 'department'>

function readDemoAccounts(): Record<string, DemoAccount> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DEMO_ACCOUNTS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, DemoAccount>) : {}
  } catch {
    return {}
  }
}

function nameFromId(id: string) {
  const local = id.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const name = local
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return name || id
}

export function getDemoUser() {
  return readSession()?.demoUser ?? null
}

/** Starts a demo session. Sign-up details are remembered per ID so a later sign-in shows the same profile. */
export function startDemoSession(input: { id: string; name?: string; role?: UserRole; department?: string | null }) {
  const id = input.id.trim()
  const key = id.toLowerCase()
  const accounts = readDemoAccounts()
  const known = accounts[key]
  const account: DemoAccount = {
    name: input.name?.trim() || known?.name || nameFromId(id),
    role: input.role ?? known?.role ?? 'student',
    department: input.department !== undefined ? input.department || null : (known?.department ?? null),
  }
  try {
    window.localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify({ ...accounts, [key]: account }))
  } catch {}
  const user: User = { id, email: id, avatarUrl: null, ...account }
  writeSession({ accessToken: null, refreshToken: null, demoUser: user })
  return user
}

export function updateDemoUser(changes: Partial<Pick<User, 'name' | 'department'>>) {
  const current = getDemoUser()
  if (!current) throw new Error('No demo session')
  return startDemoSession({
    id: current.id,
    name: changes.name ?? current.name,
    role: current.role,
    department: changes.department !== undefined ? changes.department : current.department,
  })
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    cache = undefined
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

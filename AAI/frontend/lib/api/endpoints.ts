/**
 * Single source of truth for every backend call the frontend makes, matched to the FastAPI routes in
 * AAI/backend/main.py. A `null` contract means the backend has no route for that action yet: the UI
 * shows an honest "not connected" message and never sends a request or reports success.
 *
 * When the backend's JSON differs from the view models in ./schemas.ts, `mapResponse` / `mapRequest`
 * adapt it. Responses are validated against those view models before they reach the UI.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type EndpointContract = {
  method: HttpMethod
  /** Path relative to NEXT_PUBLIC_API_BASE_URL. Use `{name}` for path params, e.g. `/notifications/{id}/read`. */
  path: string
  /** Convert the frontend input into the backend's request body (POST/PUT/PATCH) or query (GET). */
  mapRequest?: (input: unknown) => unknown
  /** Convert the backend's JSON into the frontend view model before validation. */
  mapResponse?: (raw: unknown) => unknown
}

type IntegrationPoint = {
  purpose: string
  needs: string[]
  contract: EndpointContract | null
}

type BackendUser = { id: string; name: string; email: string; role: string; department?: string | null }

/** The `users` table stores Students as `organizer`. Admins are rejected by the backend's auth routes. */
const toFrontendRole = (role: string) => (role === 'organizer' ? 'student' : role)
const toBackendRole = (role: unknown) => (role === 'student' ? 'organizer' : role)

const mapUser = (raw: unknown) => {
  const u = raw as BackendUser | null
  return u && typeof u === 'object' ? { ...u, role: toFrontendRole(u.role) } : u
}

const mapSession = (raw: unknown) => {
  const r = (raw ?? {}) as {
    access_token?: string | null
    refresh_token?: string | null
    user?: unknown
    requires_email_confirmation?: boolean
  }
  return {
    accessToken: r.access_token ?? null,
    refreshToken: r.refresh_token ?? null,
    user: r.user ? mapUser(r.user) : null,
    requiresEmailConfirmation: Boolean(r.requires_email_confirmation),
  }
}

export const INTEGRATION_POINTS = {
  'auth.signIn': {
    purpose: 'Exchange a university email + password for a Supabase Auth session (Student or Faculty).',
    needs: [],
    contract: { method: 'POST', path: '/api/auth/login', mapResponse: mapSession },
  },
  'auth.signUp': {
    purpose: 'Create a Student or Faculty account. Admin accounts cannot be created here.',
    needs: [],
    contract: {
      method: 'POST',
      path: '/api/auth/signup',
      mapRequest: (input) => {
        const i = input as Record<string, unknown>
        return { ...i, role: toBackendRole(i.role) }
      },
      mapResponse: mapSession,
    },
  },
  'auth.refresh': {
    purpose: 'Renew an expired access token with the stored refresh token.',
    needs: [],
    contract: { method: 'POST', path: '/api/auth/refresh', mapResponse: mapSession },
  },
  'auth.signOut': {
    purpose: 'Invalidate the current session.',
    needs: [],
    contract: { method: 'POST', path: '/api/auth/logout' },
  },
  'auth.me': {
    purpose: 'Return the signed-in user: id, full name, university email, role, department.',
    needs: [],
    contract: { method: 'GET', path: '/api/auth/me', mapResponse: mapUser },
  },
  'profile.update': {
    purpose: 'Update editable profile fields (name, department) of the signed-in user.',
    needs: [],
    contract: { method: 'PATCH', path: '/api/auth/me', mapResponse: mapUser },
  },
  'campus.overview': {
    purpose:
      'Resources, the timetable for one weekday, all bookings and campus policies. Bookings, requests, schedule, activity, notifications, venue availability, guest house, parking and search are derived from it in ./campus.ts.',
    needs: [
      'Backend: this route is unauthenticated and returns every user’s bookings; user-scoped routes should replace the frontend email filter.',
    ],
    contract: { method: 'GET', path: '/api/dashboard/overview' },
  },
  'venues.requestBooking': {
    purpose: 'Submit a booking request for a venue (staged as PENDING_APPROVAL for Estate Admin review).',
    needs: [
      'Backend: no REST route creates bookings. create_coordinated_booking_request exists only as an agent tool, and the agent has it disabled.',
    ],
    contract: null,
  },
  'guestHouse.request': {
    purpose: 'Submit an MDC Guest House stay request.',
    needs: ['Backend: no REST route creates guest house bookings (bookings table has no guest name/phone/check-out columns).'],
    contract: null,
  },
  'parking.visitorRequest': {
    purpose: 'Submit a visitor parking request.',
    needs: ['Backend: no REST route creates parking bookings (bookings table has no visitor/vehicle columns).'],
    contract: null,
  },
  'notifications.markRead': {
    purpose: 'Mark a notification as read.',
    needs: ['Backend: notifications and their read state are not stored.'],
    contract: null,
  },
  'assistant.send': {
    purpose: 'Send a message to the Vasukii AI agent and receive its reply.',
    needs: [],
    contract: {
      method: 'POST',
      path: '/api/agent/chat',
      mapRequest: (input) => {
        const i = input as { prompt: string; email?: string | null }
        return i.email ? { prompt: i.prompt, organizer_email: i.email } : { prompt: i.prompt }
      },
      mapResponse: (raw) => ({ reply: (raw as { response?: unknown } | null)?.response }),
    },
  },
} satisfies Record<string, IntegrationPoint>

export type EndpointKey = keyof typeof INTEGRATION_POINTS

export function getContract(key: EndpointKey): EndpointContract | null {
  return (INTEGRATION_POINTS[key] as IntegrationPoint).contract
}

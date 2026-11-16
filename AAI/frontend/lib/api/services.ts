import { apiRequest } from './client'
import { ASSISTANT_TIMEOUT_MS } from './config'
import { findAvailableVenues, weekdayOf } from './campus'
import { InputError } from './errors'
import {
  assistantReplySchema,
  bookingRequestSchema,
  campusOverviewSchema,
  emptyResponseSchema,
  signInResultSchema,
  userSchema,
  type VenueKind,
} from './schemas'
import { clearSession, setSession } from './session'

export type SignUpInput = {
  name: string
  email: string
  password: string
  role: 'student' | 'faculty'
  department?: string
  redirect_to?: string
}

function storeSession(result: { accessToken?: string | null; refreshToken?: string | null }) {
  if (result.accessToken) setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken })
}

export const authService = {
  async signIn(input: { email: string; password: string }) {
    const result = await apiRequest('auth.signIn', signInResultSchema, { input })
    storeSession(result)
    return result
  },
  async signUp(input: SignUpInput) {
    const result = await apiRequest('auth.signUp', signInResultSchema, { input })
    storeSession(result)
    return result
  },
  async signOut() {
    try {
      await apiRequest('auth.signOut', emptyResponseSchema)
    } finally {
      clearSession()
    }
  },
  me: () => apiRequest('auth.me', userSchema),
  updateProfile: (input: { name: string; department?: string }) => apiRequest('profile.update', userSchema, { input }),
}

export const campusService = {
  /** `day` selects which weekday's timetable slots are included; everything else is unfiltered. */
  overview: (day?: string) => apiRequest('campus.overview', campusOverviewSchema, { input: day ? { day } : undefined }),
}

export const activityService = {
  markNotificationRead: (id: string) => apiRequest('notifications.markRead', emptyResponseSchema, { params: { id } }),
}

export type VenueSearchInput = {
  kind: VenueKind
  date: string
  startTime: string
  endTime: string
  attendees?: number
}

export type VenueBookingInput = VenueSearchInput & { venueId: string; purpose: string }

export const venueService = {
  async searchAvailable(input: VenueSearchInput) {
    if (input.endTime <= input.startTime) throw new InputError('End time must be after start time.')
    const overview = await campusService.overview(weekdayOf(input.date))
    return findAvailableVenues(overview, input)
  },
  requestBooking: (input: VenueBookingInput) => apiRequest('venues.requestBooking', bookingRequestSchema, { input }),
}

export type GuestHouseRequestInput = {
  guestName: string
  guestPhone: string
  checkIn: string
  checkOut: string
  guests: number
  purpose: string
}

export const guestHouseService = {
  request: (input: GuestHouseRequestInput) => apiRequest('guestHouse.request', bookingRequestSchema, { input }),
}

export type VisitorParkingInput = {
  visitorName: string
  vehicleNumber: string
  date: string
  startTime: string
  endTime: string
  purpose: string
}

export const parkingService = {
  visitorRequest: (input: VisitorParkingInput) => apiRequest('parking.visitorRequest', bookingRequestSchema, { input }),
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

/** Removes reasoning traces a model may leak, and Markdown markers the plain-text chat can't render. */
function sanitizeReply(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

const HISTORY_TURNS = 6
const HISTORY_CHARS = 600

/** The agent endpoint takes a single prompt, so recent turns are folded in to keep follow-ups in context. */
function buildPrompt(message: string, history: ChatTurn[]) {
  const recent = history.slice(-HISTORY_TURNS)
  if (recent.length === 0) return message
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'User' : 'Vasukii'}: ${t.content.slice(0, HISTORY_CHARS)}`)
    .join('\n')
  return `Conversation so far:\n${transcript}\n\nUser's new message: ${message}`
}

export const assistantService = {
  async send(input: { message: string; history: ChatTurn[]; email?: string | null }, signal?: AbortSignal) {
    const { reply } = await apiRequest('assistant.send', assistantReplySchema, {
      input: { prompt: buildPrompt(input.message, input.history), email: input.email },
      signal,
      timeoutMs: ASSISTANT_TIMEOUT_MS,
    })
    return sanitizeReply(reply)
  },
}

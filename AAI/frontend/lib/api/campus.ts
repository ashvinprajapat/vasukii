import type {
  Activity,
  BackendBooking,
  BackendResource,
  Booking,
  BookingRequest,
  BookingStatus,
  CampusOverview,
  GuestHouseInfo,
  Notification,
  ParkingInfo,
  SearchResult,
  ServiceKind,
  Venue,
  VenueKind,
} from './schemas'

/**
 * Views derived from GET /api/dashboard/overview, the only backend route that exposes the Supabase
 * resources, timetable and bookings tables. JKLU dates and times are stored in campus time (IST).
 */

const CAMPUS_TZ = 'Asia/Kolkata'
const CAMPUS_OFFSET = '+05:30'

const categoryToService: Record<string, ServiceKind> = {
  classroom: 'classroom',
  laboratory: 'lab',
  amphitheatre: 'amphitheatre',
  mdc_guest_room: 'guest-house',
  parking_slot: 'parking',
}

export const venueKindToCategory: Record<VenueKind, string> = {
  classroom: 'classroom',
  lab: 'laboratory',
  amphitheatre: 'amphitheatre',
}

const statusMap: Record<string, BookingStatus> = {
  PENDING_APPROVAL: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
}

const hhmm = (time: string) => time.slice(0, 5)

const toIso = (date: string, time: string) => `${date}T${hhmm(time)}:00${CAMPUS_OFFSET}`

/** Same rule as the backend's `times_overlap`. */
export const timesOverlap = (s1: string, e1: string, s2: string, e2: string) =>
  (hhmm(s1) > hhmm(s2) ? hhmm(s1) : hhmm(s2)) < (hhmm(e1) < hhmm(e2) ? hhmm(e1) : hhmm(e2))

function campusNow() {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TZ }).format(now)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  return { date, time }
}

export function weekdayOf(date: string) {
  const d = new Date(`${date}T12:00:00${CAMPUS_OFFSET}`)
  return new Intl.DateTimeFormat('en-US', { timeZone: CAMPUS_TZ, weekday: 'long' }).format(d)
}

const resourceMap = (o: CampusOverview) => new Map(o.resources.map((r) => [r.id, r]))

const statusOf = (b: BackendBooking) => statusMap[b.status.toUpperCase()] ?? 'pending'

const serviceOf = (r: BackendResource | undefined) => (r && categoryToService[r.category]) || 'classroom'

const venueNameOf = (b: BackendBooking, resources: Map<string, BackendResource>) =>
  (b.resource_id && resources.get(b.resource_id)?.name) || b.resource_id || 'Campus venue'

function isUpcoming(b: BackendBooking, now = campusNow()) {
  return b.booking_date > now.date || (b.booking_date === now.date && hhmm(b.end_time) >= now.time)
}

function userBookings(o: CampusOverview, email: string) {
  const me = email.trim().toLowerCase()
  return o.bookings.filter((b) => b.organizer_email.trim().toLowerCase() === me)
}

const byStart = (a: BackendBooking, b: BackendBooking) =>
  `${a.booking_date}${a.start_time}`.localeCompare(`${b.booking_date}${b.start_time}`)

const byCreatedDesc = (a: BackendBooking, b: BackendBooking) => (b.created_at ?? '').localeCompare(a.created_at ?? '')

function toBooking(b: BackendBooking, resources: Map<string, BackendResource>): Booking {
  const resource = b.resource_id ? resources.get(b.resource_id) : undefined
  const details = [
    b.resource_id,
    b.expected_attendees ? `${b.expected_attendees} attendees` : null,
    b.admin_remarks ? `Admin: ${b.admin_remarks}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    id: b.id,
    title: b.event_title,
    venueName: venueNameOf(b, resources),
    service: serviceOf(resource),
    start: toIso(b.booking_date, b.start_time),
    end: toIso(b.booking_date, b.end_time),
    status: statusOf(b),
    details: details || null,
  }
}

export function selectUpcomingBookings(o: CampusOverview, email: string): Booking[] {
  const resources = resourceMap(o)
  const now = campusNow()
  return userBookings(o, email)
    .filter((b) => statusOf(b) !== 'rejected' && isUpcoming(b, now))
    .sort(byStart)
    .map((b) => toBooking(b, resources))
}

export function selectSchedule(o: CampusOverview, email: string): Booking[] {
  return selectUpcomingBookings(o, email).filter((b) => b.status === 'approved')
}

export function selectRequests(o: CampusOverview, email: string): BookingRequest[] {
  const resources = resourceMap(o)
  return userBookings(o, email)
    .sort(byCreatedDesc)
    .map((b) => ({
      id: b.id,
      label: `${b.event_title} · ${venueNameOf(b, resources)}`,
      service: serviceOf(b.resource_id ? resources.get(b.resource_id) : undefined),
      submittedAt: b.created_at ?? toIso(b.booking_date, b.start_time),
      status: statusOf(b),
    }))
}

const statusPhrase: Record<BookingStatus, string> = {
  pending: 'is awaiting admin approval',
  approved: 'was approved',
  rejected: 'was declined',
  cancelled: 'was cancelled',
}

export function selectActivity(o: CampusOverview, email: string): Activity[] {
  const resources = resourceMap(o)
  return userBookings(o, email)
    .filter((b) => b.created_at)
    .sort(byCreatedDesc)
    .map((b) => {
      const service = serviceOf(b.resource_id ? resources.get(b.resource_id) : undefined)
      return {
        id: b.id,
        text: `Your request for ${venueNameOf(b, resources)} on ${b.booking_date} ${statusPhrase[statusOf(b)]}.`,
        occurredAt: b.created_at as string,
        kind: service === 'parking' ? 'parking' : 'booking',
      }
    })
}

/** Admin decisions on the user's requests. Read state isn't stored by the backend, so decisions on upcoming bookings count as unread. */
export function selectNotifications(o: CampusOverview, email: string): Notification[] {
  const resources = resourceMap(o)
  const now = campusNow()
  return userBookings(o, email)
    .filter((b) => statusOf(b) === 'approved' || statusOf(b) === 'rejected')
    .sort(byCreatedDesc)
    .map((b) => {
      const approved = statusOf(b) === 'approved'
      return {
        id: b.id,
        title: approved ? 'Booking approved' : 'Booking declined',
        body: `${venueNameOf(b, resources)} · ${b.event_title} on ${b.booking_date}, ${hhmm(b.start_time)}–${hhmm(b.end_time)}${
          b.admin_remarks ? ` — ${b.admin_remarks}` : ''
        }`,
        createdAt: b.created_at ?? toIso(b.booking_date, b.start_time),
        read: !isUpcoming(b, now),
      }
    })
}

const describeResource = (r: BackendResource) =>
  [r.capacity ? `Up to ${r.capacity} ${r.category === 'mdc_guest_room' ? 'guests' : 'people'}` : null, r.features?.join(', ')]
    .filter(Boolean)
    .join(' · ')

export function selectGuestHouse(o: CampusOverview): GuestHouseInfo {
  const rooms = o.resources.filter((r) => r.category === 'mdc_guest_room' && r.is_active !== false)
  const sections = o.policies
    .filter((p) => p.category === 'mdc_guest_room')
    .map((p) => ({ title: p.rule_title, body: p.policy_text }))
  if (rooms.length) {
    sections.push({
      title: `Rooms (${rooms.length})`,
      body: rooms.map((r) => `${r.name} (${r.id}) — ${describeResource(r)}`).join('\n'),
    })
  }
  return { sections }
}

/** Groups parking bays by zone; a bay is free when no non-rejected booking covers the current campus time. */
export function selectParking(o: CampusOverview): ParkingInfo {
  const now = campusNow()
  const occupied = new Set(
    o.bookings
      .filter(
        (b) =>
          b.resource_id &&
          statusOf(b) !== 'rejected' &&
          b.booking_date === now.date &&
          hhmm(b.start_time) <= now.time &&
          now.time < hhmm(b.end_time),
      )
      .map((b) => b.resource_id as string),
  )
  const zones = new Map<string, BackendResource[]>()
  for (const r of o.resources) {
    if (r.category !== 'parking_slot' || r.is_active === false) continue
    const zone = r.building || 'Campus parking'
    zones.set(zone, [...(zones.get(zone) ?? []), r])
  }
  return {
    zones: [...zones.entries()].map(([name, slots]) => ({
      id: name,
      name,
      description: slots.map((s) => `${s.id}${s.features?.length ? ` (${s.features.join(', ')})` : ''}`).join(' · '),
      capacity: slots.length,
      available: slots.filter((s) => !occupied.has(s.id)).length,
    })),
  }
}

const serviceHref: Record<ServiceKind, string> = {
  classroom: '/bookings/new?type=classroom',
  lab: '/bookings/new?type=lab',
  amphitheatre: '/bookings/new?type=amphitheatre',
  'guest-house': '/guest-house',
  parking: '/parking',
}

export function searchCampus(o: CampusOverview, email: string, q: string): SearchResult[] {
  const term = q.trim().toLowerCase()
  if (!term) return []
  const matches = (...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(term))
  const resources = resourceMap(o)

  const venues: SearchResult[] = o.resources
    .filter((r) => r.is_active !== false && matches(r.id, r.name, r.building, r.category.replace(/_/g, ' '), ...(r.features ?? [])))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      type: 'venue',
      title: r.name,
      subtitle: [r.id, r.building, r.capacity ? `Capacity ${r.capacity}` : null].filter(Boolean).join(' · '),
      href: serviceHref[serviceOf(r)],
    }))

  const bookings: SearchResult[] = userBookings(o, email)
    .filter((b) => matches(b.event_title, b.resource_id, venueNameOf(b, resources), b.booking_date))
    .slice(0, 20)
    .map((b) => ({
      id: b.id,
      type: 'booking',
      title: b.event_title,
      subtitle: `${venueNameOf(b, resources)} · ${b.booking_date} ${hhmm(b.start_time)}–${hhmm(b.end_time)}`,
      href: '/bookings',
    }))

  return [...venues, ...bookings]
}

/**
 * Mirrors the backend's `check_availability_and_clashes` tool against the timetable and bookings for
 * the requested weekday (the tool itself isn't exposed as a REST route).
 */
export function findAvailableVenues(
  o: CampusOverview,
  input: { kind: VenueKind; date: string; startTime: string; endTime: string; attendees?: number },
): Venue[] {
  const category = venueKindToCategory[input.kind]
  const day = weekdayOf(input.date)
  const clashes = (id: string) =>
    o.timetables.some(
      (t) => t.resource_id === id && t.day_of_week === day && timesOverlap(input.startTime, input.endTime, t.start_time, t.end_time),
    ) ||
    o.bookings.some(
      (b) =>
        b.resource_id === id &&
        b.booking_date === input.date &&
        statusOf(b) !== 'rejected' &&
        timesOverlap(input.startTime, input.endTime, b.start_time, b.end_time),
    )

  return o.resources
    .filter((r) => r.category === category && r.is_active !== false)
    .filter((r) => !input.attendees || (r.capacity ?? 0) >= input.attendees)
    .filter((r) => !clashes(r.id))
    .map((r) => ({ id: r.id, name: r.name, kind: input.kind, building: r.building, capacity: r.capacity }))
}

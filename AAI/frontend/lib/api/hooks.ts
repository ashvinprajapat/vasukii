'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import {
  searchCampus,
  selectActivity,
  selectGuestHouse,
  selectNotifications,
  selectParking,
  selectRequests,
  selectSchedule,
  selectUpcomingBookings,
} from './campus'
import { hasSession, subscribeSession } from './session'
import { ApiError, isIntegrationPending } from './errors'
import type { CampusOverview } from './schemas'
import { authService, campusService } from './services'

const config: SWRConfiguration = {
  revalidateOnFocus: false,
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    if (isIntegrationPending(error)) return
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) return
    if (retryCount >= 3) return
    setTimeout(() => revalidate({ retryCount }), 2000 * 2 ** retryCount)
  },
}

const OVERVIEW_KEY = 'campus.overview'

/** Every booking-derived view reads the same overview, so revalidating any of these keys refreshes all of them. */
export const swrKeys = {
  me: 'auth.me',
  bookings: OVERVIEW_KEY,
  requests: OVERVIEW_KEY,
  schedule: OVERVIEW_KEY,
  activity: OVERVIEW_KEY,
  notifications: OVERVIEW_KEY,
  guestHouse: OVERVIEW_KEY,
  parking: OVERVIEW_KEY,
} as const

export type SessionStatus = 'unknown' | 'signed-in' | 'signed-out'

/** 'unknown' during server render and hydration, then reflects the stored session. */
export function useSessionStatus(): SessionStatus {
  return useSyncExternalStore<SessionStatus>(
    subscribeSession,
    () => (hasSession() ? 'signed-in' : 'signed-out'),
    () => 'unknown',
  )
}

export function useCurrentUser() {
  const status = useSessionStatus()
  const query = useSWR(status === 'signed-in' ? swrKeys.me : null, authService.me, config)
  return { ...query, isLoading: query.isLoading || status === 'unknown', status }
}

function useOverview(enabled: boolean) {
  return useSWR(enabled ? OVERVIEW_KEY : null, () => campusService.overview(), config)
}

function useCampusView<T>(select: (o: CampusOverview) => T) {
  const status = useSessionStatus()
  const overview = useOverview(status === 'signed-in')
  const data = useMemo(() => (overview.data ? select(overview.data) : undefined), [overview.data, select])
  return { data, error: overview.error, isLoading: overview.isLoading || status === 'unknown', mutate: overview.mutate }
}

/** Views scoped to the signed-in user's bookings (matched on their university email). */
function useUserView<T>(select: (o: CampusOverview, email: string) => T) {
  const user = useCurrentUser()
  const overview = useOverview(user.status === 'signed-in')
  const email = user.data?.email
  const data = useMemo(
    () => (overview.data && email ? select(overview.data, email) : undefined),
    [overview.data, email, select],
  )
  return {
    data,
    error: user.error ?? overview.error,
    isLoading: user.isLoading || overview.isLoading,
    mutate: () => Promise.all([user.mutate(), overview.mutate()]),
  }
}

export const useUpcomingBookings = () => useUserView(selectUpcomingBookings)
export const useBookingRequests = () => useUserView(selectRequests)
export const useSchedule = () => useUserView(selectSchedule)
export const useRecentActivity = () => useUserView(selectActivity)
export const useNotifications = () => useUserView(selectNotifications)
export const useGuestHouseInfo = () => useCampusView(selectGuestHouse)
export const useParkingInfo = () => useCampusView(selectParking)

export function useSearch(q: string) {
  const select = useCallback((o: CampusOverview, email: string) => searchCampus(o, email, q), [q])
  return useUserView(select)
}

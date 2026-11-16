/**
 * Base URL of the Vasukii FastAPI backend, read only from NEXT_PUBLIC_API_BASE_URL
 * (default value lives in `.env`; v0 / Vercel project variables override it).
 * Next.js inlines NEXT_PUBLIC_ variables at dev-server start / build time, so changing it
 * requires a dev-server restart or a redeploy.
 * Never put secrets (Supabase service-role keys, provider API keys) in NEXT_PUBLIC_ variables.
 * When unset or invalid this is '', and API calls fail fast with IntegrationPendingError.
 */
function resolveBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? ''
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : ''
  } catch {
    return ''
  }
}

export const API_BASE_URL = resolveBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)

export const REQUEST_TIMEOUT_MS = 20_000

/** Assistant responses can involve several tool calls on the backend. */
export const ASSISTANT_TIMEOUT_MS = 90_000

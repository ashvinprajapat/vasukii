const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()

if (!apiBaseUrl || !/^https?:\/\//.test(apiBaseUrl)) {
  console.warn(
    '[vasukii] NEXT_PUBLIC_API_BASE_URL is missing or not an http(s) URL. Sign-in and other API calls will be disabled.',
  )
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig

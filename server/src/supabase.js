import { createClient } from '@supabase/supabase-js'

const maxAuthAttempts = 3

function isUserLookup(input) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
  return typeof url === 'string' && url.includes('/auth/v1/user')
}

async function fetchWithAuthRetry(input, init) {
  if (!isUserLookup(input)) return globalThis.fetch(input, init)

  for (let attempt = 1; attempt <= maxAuthAttempts; attempt += 1) {
    let response
    try {
      response = await globalThis.fetch(input, init)
    } catch (error) {
      if (init?.signal?.aborted || attempt === maxAuthAttempts) throw error
    }

    if (response && response.status !== 429 && response.status < 500) return response
    if (attempt === maxAuthAttempts) return response
    await new Promise((resolve) => setTimeout(resolve, attempt * 300))
  }
}

export function createUserSupabaseClient(accessToken) {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured for the API.')
  }
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('A Supabase access token is required.')
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: fetchWithAuthRetry
    }
  })
}

export async function authenticateSupabaseToken(accessToken) {
  const client = createUserSupabaseClient(accessToken)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error) {
    if (error.status === 401 || error.status === 403) return null
    throw error
  }
  if (!data.user) return null

  return {
    client,
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Community member'
    }
  }
}

export function getBearerToken(request) {
  const header = request.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1] || null
}

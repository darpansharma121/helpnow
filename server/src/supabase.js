import { createClient } from '@supabase/supabase-js'

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
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  })
}

export async function authenticateSupabaseToken(accessToken) {
  const client = createUserSupabaseClient(accessToken)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) return null

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

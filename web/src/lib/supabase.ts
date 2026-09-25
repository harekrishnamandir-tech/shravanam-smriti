import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// The anon/publishable key is public by design; row-level security in the
// database is what protects the data.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Where OAuth / magic links send the user back to (the app root, not a hash route). */
export function authRedirectUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL
}

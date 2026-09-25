import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import type { Me } from '../../lib/types'

interface AuthState {
  session: Session | null
  ready: boolean
  me: Me | null
  meLoading: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setReady(true)
      if (!s) qc.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  // Drop the ?code= left behind by the OAuth / magic-link redirect.
  useEffect(() => {
    if (session && window.location.search.includes('code=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    }
  }, [session])

  const meQuery = useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: api.me,
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
  })

  const value: AuthState = {
    session,
    ready,
    me: meQuery.data ?? null,
    meLoading: Boolean(session) && meQuery.isLoading,
    signOut: async () => {
      await supabase.auth.signOut()
      qc.clear()
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

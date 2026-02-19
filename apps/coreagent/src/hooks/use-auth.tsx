import { createContext, useContext, useEffect, useState } from "react"
import { User, Session } from "@supabase/supabase-js"
import { invoke } from "@tauri-apps/api/core"
import supabase from "@/lib/supabase"
import { clearCache } from "@/lib/tauri-store"

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        // Check active session on mount
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          return
        }

        const validatedUser = await validateUserInAuth(session)
        if (!validatedUser) {
          console.warn("Session user no longer exists in auth.users - forcing sign out")
          await forceSignOut()
          return
        }

        // Verify session exists in Rust backend
        const isValid = await verifySessionWithBackend(validatedUser.id)
        if (!isValid) {
          // Backend doesn't have session - sync it
          console.warn("Session mismatch - resyncing to backend")
          await syncSessionToBackend(session)
        }

        setSession(session)
        setUser(validatedUser)
      } catch (error) {
        console.error("Failed to bootstrap auth state:", error)
        await forceSignOut()
      } finally {
        setLoading(false)
      }
    }

    void bootstrapAuth()

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const validatedUser = await validateUserInAuth(session)
        if (!validatedUser) {
          console.warn("Auth state changed with stale user - forcing sign out")
          await forceSignOut()
          return
        }

        setSession(session)
        setUser(validatedUser)
        // Sync session to Rust backend
        await syncSessionToBackend(session)
      } else {
        setSession(null)
        setUser(null)
        // Clear session from Rust backend
        await clearSessionFromBackend()
        await clearCache()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const verifySessionWithBackend = async (userId: string): Promise<boolean> => {
    try {
      return await invoke<boolean>("verify_session", { userId })
    } catch (error) {
      console.error("Failed to verify session with backend:", error)
      return false
    }
  }

  const syncSessionToBackend = async (session: Session) => {
    try {
      await invoke("set_session", {
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user_id: session.user.id,
          expires_at: session.expires_at || 0,
        },
      })
    } catch (error) {
      console.error("Failed to sync session to backend:", error)
    }
  }

  const clearSessionFromBackend = async () => {
    try {
      await invoke("clear_session")
    } catch (error) {
      console.error("Failed to clear session from backend:", error)
    }
  }

  const validateUserInAuth = async (session: Session): Promise<User | null> => {
    try {
      const { data, error } = await supabase.auth.getUser(session.access_token)
      if (error || !data.user) {
        console.warn("Failed to validate user against auth.users:", error)
        return null
      }

      if (data.user.id !== session.user.id) {
        console.warn("Session user mismatch during auth.users validation")
        return null
      }

      return data.user
    } catch (error) {
      console.error("Unexpected error validating user against auth.users:", error)
      return null
    }
  }

  const forceSignOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error("Error signing out:", error)
    } finally {
      setSession(null)
      setUser(null)
      await clearSessionFromBackend()
      await clearCache()
    }
  }

  const signOut = async () => {
    await forceSignOut()
  }

  const value = {
    user,
    session,
    loading,
    isAuthenticated: !!session,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

import { createContext, useContext, useEffect, useState } from "react"
import { User, Session } from "@supabase/supabase-js"
import { invoke } from "@tauri-apps/api/core"
import supabase from "@/lib/supabase"

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
    // Check active session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Verify session exists in Rust backend
        const isValid = await verifySessionWithBackend(session.user.id)
        
        if (isValid) {
          setSession(session)
          setUser(session.user)
        } else {
          // Backend doesn't have session - sync it
          console.warn("Session mismatch - resyncing to backend")
          await syncSessionToBackend(session)
          setSession(session)
          setUser(session.user)
        }
      }
      
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)

      if (session) {
        // Sync session to Rust backend
        await syncSessionToBackend(session)
      } else {
        // Clear session from Rust backend
        await clearSessionFromBackend()
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

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
      await clearSessionFromBackend()
    } catch (error) {
      console.error("Error signing out:", error)
    }
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

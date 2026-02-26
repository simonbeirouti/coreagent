import { Outlet, createRootRoute, useMatches, Link } from '@tanstack/react-router'
import { useMemo, useState, useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { QueryProvider } from '@/providers/query-provider'
import { ensureCacheLoaded } from '@/lib/tauri-store'
import { Toaster } from '@/components/ui/sonner'
import { appendRuntimeRunConsoleEvents } from '@/hooks/useRuntimeRunConsole'

// Module-level: start loading cache immediately
const cachePromise = ensureCacheLoaded()
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useAuth } from '@/hooks/use-auth'
import { useAgent } from '@/hooks/useAgents'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { user, signOut } = useAuth()
  const [cacheReady, setCacheReady] = useState(false)

  // Wait for cache to load before rendering
  useEffect(() => {
    cachePromise.then(() => {
      setCacheReady(true)
    }).catch(() => {
      setCacheReady(true) // Continue even if cache fails
    })
  }, [])

  useEffect(() => {
    const syncVisibility = (isForeground: boolean) => {
      invoke('set_runtime_sync_app_visibility', { isForeground }).catch((error) => {
        console.error('Failed updating runtime sync app visibility:', error)
      })
    }

    const triggerResumeSync = () => {
      invoke('trigger_runtime_sync_command', { reason: 'app_resume' }).catch((error) => {
        console.error('Failed triggering runtime sync on resume:', error)
      })
    }

    const handleVisibilityChange = () => {
      const isForeground = !document.hidden
      syncVisibility(isForeground)
      if (isForeground) {
        triggerResumeSync()
      }
    }

    syncVisibility(!document.hidden)
    if (!document.hidden) {
      triggerResumeSync()
    }

    window.addEventListener('focus', triggerResumeSync)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', triggerResumeSync)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let dispose: UnlistenFn | null = null
    let cancelled = false
    listen<{
      clientRunId: string
      implementationKey: string
      runId?: string | null
      status?: string | null
      message: string
      sequence: number
      timestampMs: number
    }>('direct-runtime-tool-progress', (event) => {
      if (cancelled) return
      const payload = event.payload
      appendRuntimeRunConsoleEvents([
        {
          id: `${payload.clientRunId}-${payload.sequence}-${payload.timestampMs}`,
          source: 'direct',
          clientRunId: payload.clientRunId,
          implementationKey: payload.implementationKey,
          runId: payload.runId ?? null,
          status: payload.status ?? 'running',
          message: payload.message,
          sequence: payload.sequence,
          timestampMs: payload.timestampMs,
        },
      ])
    })
      .then((unlisten) => {
        dispose = unlisten
      })
      .catch((error) => {
        console.error('Failed to subscribe to runtime console progress:', error)
      })

    return () => {
      cancelled = true
      if (dispose) {
        dispose()
      }
    }
  }, [])

  // Format user data for sidebar - memoized to prevent re-renders
  const sidebarUser = useMemo(() =>
    user ? {
      name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      email: user.email || '',
      avatar: user.user_metadata?.avatar_url || '',
    } : {
      name: 'User',
      email: '',
      avatar: '',
    }, [user]
  )

  // Wait for cache before rendering
  if (!cacheReady) {
    return null
  }

  return (
    <QueryProvider>
      <LayoutContent user={sidebarUser} onSignOut={signOut} />
      <Toaster />
    </QueryProvider>
  )
}

function LayoutContent({ 
  user, 
  onSignOut 
}: { 
  user: { name: string; email: string; avatar: string }
  onSignOut?: () => void 
}) {
  const matches = useMatches()

  // Extract agentId from route params if present
  const currentMatch = matches[matches.length - 1]
  const params = currentMatch?.params as { agentId?: string } | undefined
  const agentId = params?.agentId
  
  // Fetch agent data if we have an agentId (now inside QueryProvider)
  const { data: agent } = useAgent(agentId || '')

  // Extract pathname for stable memoization dependency
  const pathname = useMemo(() =>
    matches[matches.length - 1]?.pathname || '/',
    [matches]
  )

  // Generate breadcrumbs based on current route - memoized with stable dependencies
  const breadcrumbs = useMemo(() => {
    const breadcrumbItems: React.ReactNode[] = []
    const currentMatch = matches[matches.length - 1]
    const pathSegments = currentMatch?.pathname.split('/').filter(Boolean) ?? []

    if (pathSegments.length === 0) {
      breadcrumbItems.push(
        <BreadcrumbItem key="dashboard">
          <BreadcrumbPage>Dashboard</BreadcrumbPage>
        </BreadcrumbItem>
      )
      return breadcrumbItems
    }

    // Create breadcrumb for each path segment
    pathSegments.forEach((segment: string, index: number) => {
      const isLast = index === pathSegments.length - 1
      // Check if this segment is a UUID (agent ID)
      const isUUID = segment.length > 20 && segment.includes('-')
      
      // Use agent name if available and this is a UUID, otherwise capitalize
      let segmentName: string | React.ReactNode
      if (isUUID && agent?.name) {
        segmentName = agent.name
      } else if (isUUID && agentId && !agent) {
        // Agent is loading
        segmentName = <Skeleton className="h-4 w-20 inline-block" />
      } else if (isUUID) {
        segmentName = 'Agent'
      } else {
        segmentName = segment.charAt(0).toUpperCase() + segment.slice(1)
      }

      if (isLast) {
        breadcrumbItems.push(
          <BreadcrumbItem key={segment}>
            <BreadcrumbPage>{segmentName}</BreadcrumbPage>
          </BreadcrumbItem>
        )
      } else {
        breadcrumbItems.push(
          <BreadcrumbItem key={segment} className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link to={`/${pathSegments.slice(0, index + 1).join('/')}` as any}>
                {segmentName}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
        )
        if (index < pathSegments.length - 1) {
          breadcrumbItems.push(
            <BreadcrumbSeparator key={`sep-${segment}`} className="hidden md:block" />
          )
        }
      }
    })

    return breadcrumbItems
  }, [pathname, matches.length, agent?.name])

  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <AppSidebar user={user} onSignOut={onSignOut} />
      <SidebarInset className="h-full flex flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

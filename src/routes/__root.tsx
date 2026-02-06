import { Outlet, createRootRoute, useMatches, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { AppSidebar } from '@/components/dashboard/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useAuth } from '@/hooks/use-auth'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { user, signOut } = useAuth()
  const matches = useMatches()

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

  // Extract pathname for stable memoization dependency
  const pathname = useMemo(() =>
    matches[matches.length - 1]?.pathname || '/',
    [matches]
  )

  // Generate breadcrumbs based on current route - memoized with stable dependencies
  const breadcrumbs = useMemo(() => {
    const breadcrumbItems = [
      <BreadcrumbItem key="coreagent" className="hidden md:block">
        <BreadcrumbLink asChild>
          <Link to="/">Dashboard</Link>
        </BreadcrumbLink>
      </BreadcrumbItem>,
    ]

    if (matches.length > 1) {
      const currentMatch = matches[matches.length - 1]
      const pathSegments = currentMatch.pathname.split('/').filter(Boolean)

      if (pathSegments.length > 0) {
        breadcrumbItems.push(
          <BreadcrumbSeparator key="separator" className="hidden md:block" />
        )

        // Create breadcrumb for each path segment
        pathSegments.forEach((segment, index) => {
          const isLast = index === pathSegments.length - 1
          const segmentName = segment.charAt(0).toUpperCase() + segment.slice(1)

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
      }
    } else {
      breadcrumbItems.push(
        <BreadcrumbSeparator key="dashboard-separator" className="hidden md:block" />
      )
      breadcrumbItems.push(
        <BreadcrumbItem key="dashboard">
          <BreadcrumbPage>Dashboard</BreadcrumbPage>
        </BreadcrumbItem>
      )
    }

    return breadcrumbItems
  }, [pathname, matches.length])

  return (
    <SidebarProvider>
      <AppSidebar user={sidebarUser} onSignOut={signOut} />
      <SidebarInset>
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
        <div className="flex flex-1 flex-col px-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
"use client"

import { Link } from "@tanstack/react-router"
import { useAuth } from "@/hooks/use-auth"
import { useAgents } from "@/hooks/useAgents"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

// Default emoji mapping for agent names (placeholder until we have avatars)
const DEFAULT_EMOJI = "🤖"

// State color mapping
const STATE_COLORS = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  stopped: "bg-red-500",
}

export function NavAgents() {
  const { user } = useAuth()
  const userId = user?.id || ""
  const { data: agents, isLoading } = useAgents(userId)

  return (
    <SidebarGroup className="-mt-4 group-data-[collapsible=icon]:mt-0">
      <SidebarGroupLabel>Agents</SidebarGroupLabel>
      <SidebarMenu>
        {isLoading ? (
          <>
            <SidebarMenuItem>
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          </>
        ) : agents && agents.length > 0 ? (
          agents.map((agent) => (
            <SidebarMenuItem key={agent.id}>
              <SidebarMenuButton 
                className="border border-foreground/10 h-12 hover:bg-foreground/10 transition-colors group-data-[collapsible=icon]:border-0" 
                size="lg"
                tooltip={agent.name}
                asChild
              >
                <Link 
                  className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:items-center" 
                  to="/agents/$agentId/chat" 
                  params={{ agentId: agent.id }}
                >
                  <span className="relative text-lg">
                    {DEFAULT_EMOJI}
                    {/* State indicator overlay - only visible when collapsed */}
                    <span 
                      className={cn(
                        "hidden group-data-[collapsible=icon]:block absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-background",
                        STATE_COLORS[agent.state]
                      )}
                      title={agent.state}
                    />
                  </span>
                  <span className="flex-1 group-data-[collapsible=icon]:hidden">{agent.name}</span>
                  {/* Inline state indicator - only visible when expanded */}
                  <span 
                    className={cn(
                      "h-2 w-2 rounded-full ring-2 ring-background shrink-0 group-data-[collapsible=icon]:hidden",
                      STATE_COLORS[agent.state]
                    )}
                    title={agent.state}
                  />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))
        ) : (
          <SidebarMenuItem>
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No agents yet
            </div>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

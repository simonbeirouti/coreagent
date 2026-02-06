"use client"

import * as React from "react"
import {
  GalleryVerticalEnd,
  Bot,
  Home,
} from "lucide-react"

import { NavAgents } from "./nav-agents"
import { NavUser } from "./nav-user"
import { TeamSwitcher } from "./team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { NavMain } from "./nav-main"

// This is sample data.
const data = {
  teams: [
    {
      name: "Acme Inc",
      logo: GalleryVerticalEnd,
      plan: "Enterprise",
    },
  ],
  items: [
    {
      title: "Dashboard",
      url: "/",
      icon: Home,
    },
    {
      title: "Agents",
      url: "/agents",
      icon: Bot,
    }
  ],
}

export const AppSidebar = React.memo(function AppSidebar({
  user,
  onSignOut,
  ...props
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
  onSignOut?: () => void
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.items} />
        <NavAgents />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
})

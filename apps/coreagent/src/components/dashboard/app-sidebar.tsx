"use client"

import * as React from "react"
import {
  GalleryVerticalEnd,
  Bot,
  Home,
  FileText,
  BookOpen,
  Settings
} from "lucide-react"

import { NavAgents } from "./nav-agents"
import { NavFooter } from "./nav-footer"
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
    },
    {
      title: "Files",
      url: "/files",
      icon: FileText,
    }
  ],
  secondaryItems: [
    {
      title: "Documentation",
      url: "/documentation",
      icon: BookOpen,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings,
    },
  ],
}

export const AppSidebar = React.memo(function AppSidebar({
  user,
  onSignOut,
  footerLinks,
  ...props
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
  onSignOut?: () => void
  footerLinks?: Array<{
    title: string
    url: string
    icon?: React.ComponentType<{ className?: string }>
  }>
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
        <NavFooter
          footerLinks={footerLinks || data.secondaryItems}
          user={user}
          onSignOut={onSignOut}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
})

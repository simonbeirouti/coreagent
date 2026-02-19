"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconBolt,
  IconBriefcase,
  IconDatabase,
  IconInnerShadowTop,
  IconRobot,
  IconTool,
  IconUsers,
} from "@tabler/icons-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Overview", href: "/", icon: IconBolt },
  { title: "Users", href: "/users", icon: IconUsers },
  { title: "Agents", href: "/agents", icon: IconRobot },
  { title: "Skills", href: "/skills", icon: IconTool },
  { title: "Jobs", href: "/jobs", icon: IconBriefcase },
  { title: "Tools", href: "/tools", icon: IconDatabase },
] as const;

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5! [&>svg]:size-5">
              <Link href="/">
                <IconInnerShadowTop />
                <span className="text-base font-semibold">Admin Console</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

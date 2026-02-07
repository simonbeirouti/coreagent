import { LogOut } from "lucide-react"
import { Link } from '@tanstack/react-router'
import { Button } from "../ui/button"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface FooterLink {
  title: string
  url: string
  icon?: React.ComponentType<{ className?: string }>
}

export function NavFooter({
  footerLinks = [],
  user,
  onSignOut,
}: {
  footerLinks?: FooterLink[]
  user: {
    name: string
    email: string
    avatar: string
  }
  onSignOut?: () => void
}) {
  return (
    <>
      {footerLinks.length > 0 && (
        <SidebarMenu>
          {footerLinks.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title} asChild>
                <Link to={item.url}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}
      <div className="flex items-center justify-between p-1">
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs">{user.email}</span>
        </div>
        <Button
          variant="destructive"
          size="icon-sm"
          onClick={onSignOut}
          className="-ml-1"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </>
  )
}
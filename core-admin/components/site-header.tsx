"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { SidebarTrigger } from "@/components/ui/sidebar";

const TITLES: Record<string, string> = {
  "/": "Operations Overview",
  "/dashboard": "Operations Overview",
  "/users": "Users",
  "/agents": "Agents",
  "/skills": "Skills Registry",
  "/jobs": "Jobs",
  "/tools": "Tools",
};

export function SiteHeader() {
  const pathname = usePathname();

  const title = useMemo(() => TITLES[pathname] ?? "CoreAgent Admin", [pathname]);

  return (
    <header className="bg-background/90 sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 backdrop-blur lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold md:text-base">{title}</h1>
      </div>
    </header>
  );
}

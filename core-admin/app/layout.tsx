import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "CoreAgent Admin",
  description: "Operational console for users, agents, tools, skills, and orchestration jobs.",
};

function parseSidebarCookie(value: string | undefined): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return false;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = parseSidebarCookie(cookieStore.get("sidebar_state")?.value);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-dvh overflow-hidden">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <QueryProvider>
              <SidebarProvider
                defaultOpen={defaultSidebarOpen}
                style={
                  {
                    "--sidebar-width": "calc(var(--spacing) * 56)",
                    "--header-height": "calc(var(--spacing) * 12)",
                  } as React.CSSProperties
                }
              >
                <AppSidebar />
                <SidebarInset className="h-dvh overflow-hidden">
                  <SiteHeader />
                  <div className="flex flex-1 flex-col overflow-auto px-6 py-4">{children}</div>
                </SidebarInset>
              </SidebarProvider>
              <Toaster />
            </QueryProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

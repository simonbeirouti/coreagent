import { createFileRoute, Link, Outlet, useMatchRoute, Navigate } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { MessageSquare, Settings, Phone, Brain, BarChart3, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentLayout,
});

function AgentLayout() {
  const { agentId } = Route.useParams();
  const matchRoute = useMatchRoute();

  const { isLoading, error } = useAgent(agentId);

  // Check which route is currently active
  const isChatRoute = matchRoute({ to: '/agents/$agentId/chat', params: { agentId } });
  const isVoiceRoute = matchRoute({ to: '/agents/$agentId/voice', params: { agentId } });
  const isMemoryRoute = matchRoute({ to: '/agents/$agentId/memory', params: { agentId } });
  const isDashboardRoute = matchRoute({ to: '/agents/$agentId/dashboard', params: { agentId } });
  const isSettingsRoute = matchRoute({ to: '/agents/$agentId/settings', params: { agentId } });
  const isToolsRoute = matchRoute({ to: '/agents/$agentId/tools', params: { agentId } });
  const isExactAgentRoute = matchRoute({ to: '/agents/$agentId', params: { agentId } });

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error loading agent</div>
      </div>
    );
  }

  // Redirect to chat if on exact agent route (only when not loading)
  if (!isLoading && isExactAgentRoute && !isChatRoute && !isVoiceRoute && !isMemoryRoute && !isDashboardRoute && !isSettingsRoute && !isToolsRoute) {
    return <Navigate to="/agents/$agentId/chat" params={{ agentId }} search={{ conversationId: undefined }} replace />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Menubar */}
      <div className="p-4 bg-background shrink-0 -mt-4">

        <Menubar className="border-b border-border">
          <MenubarMenu>
            <Link to="/agents/$agentId/dashboard" params={{ agentId }}>
              <MenubarTrigger className={cn(isDashboardRoute && "bg-accent")}>
                <BarChart3 className="mr-2 h-4 w-4" />
                Dashboard
              </MenubarTrigger>
            </Link>
          </MenubarMenu>

          <MenubarMenu>
            <Link to="/agents/$agentId/chat" params={{ agentId }} search={{ conversationId: undefined }}>
              <MenubarTrigger className={cn(isChatRoute && "bg-accent")}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Chat
              </MenubarTrigger>
            </Link>
          </MenubarMenu>

          <MenubarMenu>
            <Link to="/agents/$agentId/voice" params={{ agentId }} search={{ conversationId: undefined }}>
              <MenubarTrigger className={cn(isVoiceRoute && "bg-accent")}>
                <Phone className="mr-2 h-4 w-4" />
                Voice
              </MenubarTrigger>
            </Link>
          </MenubarMenu>

          <MenubarMenu>
            <Link to="/agents/$agentId/memory" params={{ agentId }}>
              <MenubarTrigger className={cn(isMemoryRoute && "bg-accent")}>
                <Brain className="mr-2 h-4 w-4" />
                Memory
              </MenubarTrigger>
            </Link>
          </MenubarMenu>

          <MenubarMenu>
            <Link to="/agents/$agentId/tools" params={{ agentId }}>
              <MenubarTrigger className={cn(isToolsRoute && "bg-accent")}>
                <Wrench className="mr-2 h-4 w-4" />
                Tools
              </MenubarTrigger>
            </Link>
          </MenubarMenu>

          <MenubarMenu>
            <Link to="/agents/$agentId/settings" params={{ agentId }}>
              <MenubarTrigger className={cn(isSettingsRoute && "bg-accent")}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </MenubarTrigger>
            </Link>
          </MenubarMenu>
        </Menubar>
      </div>

      {/* Child Routes */}
      <div className="flex-1 flex flex-col overflow-hidden -mt-4">
        <Outlet />
      </div>
    </div>
  );
}
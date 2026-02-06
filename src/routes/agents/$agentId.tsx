import { createFileRoute, Link, Outlet, useMatchRoute, Navigate } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { MessageSquare, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentLayout,
});

function AgentLayout() {
  const { agentId } = Route.useParams();
  const matchRoute = useMatchRoute();
  
  const { data: agent, isLoading, error } = useAgent(agentId);

  // Check which route is currently active
  const isChatRoute = matchRoute({ to: '/agents/$agentId/chat', params: { agentId } });
  const isSettingsRoute = matchRoute({ to: '/agents/$agentId/settings', params: { agentId } });
  const isExactAgentRoute = matchRoute({ to: '/agents/$agentId', params: { agentId } });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading agent...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error loading agent</div>
      </div>
    );
  }

  // Redirect to chat if on exact agent route
  if (isExactAgentRoute && !isChatRoute && !isSettingsRoute) {
    return <Navigate to="/agents/$agentId/chat" params={{ agentId }} replace />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Menubar */}
      <div className="p-4 bg-background shrink-0 -mt-4 -mx-2">
        <Menubar className="border-b border-border">
          <MenubarMenu>
            <Link to="/agents/$agentId/chat" params={{ agentId }}>
              <MenubarTrigger className={cn(isChatRoute && "bg-accent")}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Chat
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
      <div className="flex-1 overflow-hidden -mt-4">
        <Outlet />
      </div>
    </div>
  );
}
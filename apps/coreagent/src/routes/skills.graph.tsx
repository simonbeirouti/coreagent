import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { useAgents } from '@/hooks/useAgents';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/skills/graph')({
  component: SkillsGraphRedirectPage,
});

function SkillsGraphRedirectPage() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { data: agents = [], isLoading } = useAgents(userId);
  const firstAgent = agents[0];

  if (isLoading) {
    return (
      <div className="px-4 pb-4 pt-2">
        <Card>
          <CardHeader>
            <CardTitle>Skills Graph</CardTitle>
            <CardDescription>Loading your agents…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (firstAgent) {
    return (
      <Navigate
        to="/agents/$agentId/skills-graph"
        params={{ agentId: firstAgent.id }}
        replace
      />
    );
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <Card>
        <CardHeader>
          <CardTitle>Skills Graph</CardTitle>
          <CardDescription>Create an agent first to start building a graph.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

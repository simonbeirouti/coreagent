import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MemoryBrowser } from '@/components/memory/memory-browser';

export const Route = createFileRoute('/agents/$agentId/memory')({
  component: AgentMemoryPage,
});

function AgentMemoryPage() {
  const { agentId } = Route.useParams();

  return (
    <div className="h-full px-4 py-4">
      <Card className="flex h-full min-h-0 flex-col">
        <CardHeader>
          <CardTitle>Agent Memory</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <MemoryBrowser agentId={agentId} />
        </CardContent>
      </Card>
    </div>
  );
}


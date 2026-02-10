import { usePersonalityAdjustments } from '@/hooks/useFeedback';

interface PersonalityEvolutionProps {
  agentId: string;
}

export function PersonalityEvolution({ agentId }: PersonalityEvolutionProps) {
  const { data: adjustments = [], isLoading } = usePersonalityAdjustments(agentId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading personality evolution...</p>;
  }

  if (!adjustments.length) {
    return <p className="text-sm text-muted-foreground">No personality adjustments yet.</p>;
  }

  return (
    <div className="space-y-3">
      {adjustments.slice(0, 8).map((adj) => (
        <div key={adj.id} className="rounded-md border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{adj.trait_name}</span>
            <span className="text-muted-foreground">
              {new Date(adj.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {adj.old_value.toFixed(2)} -&gt; {adj.new_value.toFixed(2)}
          </div>
          {adj.reason ? <div className="mt-1 text-xs">{adj.reason}</div> : null}
        </div>
      ))}
    </div>
  );
}


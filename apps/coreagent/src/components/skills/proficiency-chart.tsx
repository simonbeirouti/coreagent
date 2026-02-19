import { AgentAbility } from '@/hooks/useAbilities';
import { Progress } from '@/components/ui/progress';

interface ProficiencyChartProps {
  abilities: AgentAbility[];
}

export function ProficiencyChart({ abilities }: ProficiencyChartProps) {
  if (!abilities.length) {
    return <p className="text-sm text-muted-foreground">No skill data yet.</p>;
  }

  return (
    <div className="space-y-3">
      {abilities.map((ability) => (
        <div key={ability.id} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{ability.ability_name}</span>
            <span className="text-muted-foreground">
              {(ability.proficiency * 100).toFixed(0)}%
            </span>
          </div>
          <Progress value={ability.proficiency * 100} />
          <div className="text-xs text-muted-foreground">
            {ability.success_count}/{ability.usage_count} successful uses
          </div>
        </div>
      ))}
    </div>
  );
}


import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import type { PersonalityAdjustment, TraitState } from "@/hooks/useFeedback";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface PersonalityEvolutionProps {
  adjustments: PersonalityAdjustment[];
  traitState?: TraitState;
  isLoading?: boolean;
}

const chartConfig = {
  value: {
    label: "Trait value",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

export function PersonalityEvolution({
  adjustments,
  traitState,
  isLoading = false,
}: PersonalityEvolutionProps) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading personality evolution...</p>;
  }

  if (!adjustments.length) {
    return <p className="text-sm text-muted-foreground">No personality adjustments yet.</p>;
  }

  const recent = adjustments
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-12);
  const chartData = recent.map((adj) => ({
    date: adj.created_at,
    value: Math.round(adj.new_value * 100),
    trait: adj.trait_name,
  }));

  return (
    <div className="space-y-4">
      <ChartContainer config={chartConfig} className="h-[220px] w-full aspect-auto">
        <LineChart data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => {
              const date = new Date(value);
              return Number.isNaN(date.getTime())
                ? value
                : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return Number.isNaN(date.getTime())
                    ? String(value)
                    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }}
                formatter={(value) => [`${value}%`, "New trait value"]}
              />
            }
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ChartContainer>

      <div className="text-xs text-muted-foreground">
        Latest trait update:{" "}
        {traitState?.updated_at
          ? new Date(traitState.updated_at).toLocaleString()
          : "Not available"}
      </div>

      <div className="space-y-3">
        {adjustments.slice(0, 6).map((adj) => (
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
    </div>
  );
}


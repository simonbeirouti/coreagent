import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import type { PersonalityAdjustment, TraitState } from "@/hooks/useFeedback";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

interface PersonalityEvolutionProps {
  adjustments: PersonalityAdjustment[];
  traitState?: TraitState;
  isLoading?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
}

const chartConfig = {
  value: {
    label: "Trait value",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function PersonalityEvolution({
  adjustments,
  traitState,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: PersonalityEvolutionProps) {
  const hasData = adjustments.length > 0;
  const showSkeleton = isLoading && !hasData;
  const showError = Boolean(errorMessage) && !hasData;

  if (showSkeleton) {
    return (
      <div className="flex h-full min-h-[260px] w-full flex-col gap-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-full min-h-[200px] w-full" />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="flex h-full min-h-[260px] w-full items-center justify-center text-sm text-destructive">
        Unable to load personality timeline right now.
      </div>
    );
  }

  if (!adjustments.length) {
    return (
      <div className="flex h-full min-h-[260px] w-full items-center justify-center text-sm text-muted-foreground">
        No personality adjustments yet.
      </div>
    );
  }

  const recent = adjustments
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-12);
  const chartData = recent.map((adj) => ({
    date: adj.created_at,
    value: Math.round(toFiniteNumber(adj.new_value) * 100),
    trait: adj.trait_name,
  }));

  return (
    <div className="flex h-full min-h-[260px] flex-col gap-4">
      <ChartContainer config={chartConfig} className="flex-1 min-h-[200px] w-full aspect-auto">
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
        {isFetching ? "Updating timeline... " : null}
        Latest trait update:{" "}
        {traitState?.updated_at
          ? new Date(traitState.updated_at).toLocaleString()
          : "Not available"}
      </div>
    </div>
  );
}


"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { RetrievalTuningStatus } from "@/hooks/useMemory";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartSourceMixBarsProps {
  tuningStatus?: RetrievalTuningStatus;
  isLoading?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
}

const chartConfig = {
  count: {
    label: "Messages",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

type SourceMixPayload = {
  user_override_count?: number;
  weighted_blend_count?: number;
  agent_only_count?: number;
  heuristic_fallback_count?: number;
};

function toSafeCount(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

export function ChartSourceMixBars({
  tuningStatus,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartSourceMixBarsProps) {
  const sourceMix = (tuningStatus?.quality?.source_mix ?? {}) as SourceMixPayload;
  const hasShape =
    typeof sourceMix.user_override_count === "number" &&
    typeof sourceMix.weighted_blend_count === "number" &&
    typeof sourceMix.agent_only_count === "number" &&
    typeof sourceMix.heuristic_fallback_count === "number";

  const chartData = [
    { key: "user_override", label: "User Override", count: toSafeCount(sourceMix.user_override_count) },
    { key: "weighted_blend", label: "Weighted Blend", count: toSafeCount(sourceMix.weighted_blend_count) },
    { key: "agent_only", label: "Agent Only", count: toSafeCount(sourceMix.agent_only_count) },
    { key: "heuristic_fallback", label: "Heuristic Fallback", count: toSafeCount(sourceMix.heuristic_fallback_count) },
  ];

  const total = chartData.reduce((sum, row) => sum + row.count, 0);
  const showSkeleton = isLoading && !hasShape;
  const showError = Boolean(errorMessage) && !hasShape;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Source Mix</CardTitle>
          <CardDescription>Provenance composition for the active tuning window.</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton ? "Loading..." : isFetching ? "Updating..." : `${total} total signals`}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {showSkeleton ? (
          <div className="space-y-3 h-[300px] w-full">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : showError ? (
          <div className="h-[300px] w-full text-sm text-destructive flex items-center justify-center">
            Unable to load source-mix data right now.
          </div>
        ) : !hasShape ? (
          <div className="h-[300px] w-full text-sm text-muted-foreground flex items-center justify-center">
            Source-mix metrics are not available in the current payload yet.
          </div>
        ) : total === 0 ? (
          <div className="h-[300px] w-full text-sm text-muted-foreground flex items-center justify-center">
            No source-mix activity in the active window.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full aspect-auto">
            <BarChart data={chartData} accessibilityLayer margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis allowDecimals={false} width={36} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="count" fill="var(--chart-2)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

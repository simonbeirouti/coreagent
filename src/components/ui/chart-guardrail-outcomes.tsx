"use client";

import { Label, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import type { RetrievalTuningStatus } from "@/hooks/useMemory";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartGuardrailOutcomesProps {
  tuningStatus?: RetrievalTuningStatus;
  isLoading?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
}

const chartConfig = {
  applied: {
    label: "Applied",
    color: "hsl(var(--chart-3))",
  },
  skipped: {
    label: "Skipped",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

export function ChartGuardrailOutcomes({
  tuningStatus,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartGuardrailOutcomesProps) {
  const recentDecisions = tuningStatus?.recent_decisions ?? [];
  const appliedCount = recentDecisions.filter((decision) => decision.status === "applied").length;
  const skippedCount = recentDecisions.filter((decision) => decision.status === "skipped").length;
  const totalDecisions = appliedCount + skippedCount;
  const appliedRate = totalDecisions > 0 ? appliedCount / totalDecisions : 0;
  const chartData = [
    {
      label: "decisions",
      applied: appliedCount,
      skipped: skippedCount,
    },
  ];

  const hasData = Boolean(tuningStatus);
  const showSkeleton = isLoading && !hasData;
  const showError = Boolean(errorMessage) && !hasData;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Guardrail Outcomes</CardTitle>
          <CardDescription>Applied vs skipped decisions in the active window.</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton ? "Loading..." : isFetching ? "Updating..." : `${recentDecisions.length} recent`}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {showSkeleton ? (
          <div className="space-y-3 h-[320px] w-full">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : showError ? (
          <div className="h-[240px] w-full text-sm text-destructive flex items-center justify-center">
            Unable to load guardrail outcomes right now.
          </div>
        ) : !hasData ? (
          <div className="h-[240px] w-full text-sm text-muted-foreground flex items-center justify-center">
            No guardrail outcome data yet.
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="mx-auto h-[320px] -mb-24 w-full aspect-auto"
          >
            <RadialBarChart
              data={chartData}
              startAngle={180}
              endAngle={0}
              innerRadius={105}
              outerRadius={165}
            >
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;

                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) - 12}
                          className="fill-foreground text-3xl font-semibold"
                        >
                          {Math.round(appliedRate * 100)}%
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 12}
                          className="fill-muted-foreground text-xs"
                        >
                          applied
                        </tspan>
                      </text>
                    );
                  }}
                />
              </PolarRadiusAxis>
              <RadialBar
                dataKey="applied"
                stackId="a"
                cornerRadius={6}
                fill="var(--chart-3)"
                className="stroke-transparent stroke-2"
              />
              <RadialBar
                dataKey="skipped"
                stackId="a"
                cornerRadius={6}
                fill="var(--chart-5)"
                className="stroke-transparent stroke-2"
              />
            </RadialBarChart>
          </ChartContainer>
        )}
      </CardContent>
      {!showSkeleton && !showError && hasData ? (
        <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">
            {appliedRate >= 0.5 ? "Applied outcomes are dominant." : "Skipped outcomes are dominant."}
          </div>
          <div>
            {appliedCount.toLocaleString()} of {totalDecisions.toLocaleString()} decisions were applied.
          </div>
        </CardFooter>
      ) : null}
    </Card>
  );
}

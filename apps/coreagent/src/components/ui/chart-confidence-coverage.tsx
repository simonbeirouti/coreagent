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

interface ChartConfidenceCoverageProps {
  tuningStatus?: RetrievalTuningStatus;
  isLoading?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const chartConfig = {
  aboveTarget: {
    label: "Above target",
    color: "hsl(var(--chart-3))",
  },
  belowTarget: {
    label: "Below target",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

export function ChartConfidenceCoverage({
  tuningStatus,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartConfidenceCoverageProps) {
  const quality = tuningStatus?.quality;
  const hasShape =
    typeof quality?.confidence_target === "number" &&
    typeof quality?.confidence_scored_sample_size === "number" &&
    typeof quality?.confidence_above_target_count === "number" &&
    typeof quality?.confidence_above_target_ratio === "number";

  const confidenceTarget = hasShape ? quality.confidence_target : 0;
  const confidenceScoredSampleSize = hasShape ? quality.confidence_scored_sample_size : 0;
  const confidenceAboveTargetCount = hasShape ? quality.confidence_above_target_count : 0;
  const confidenceAboveTargetRatio = hasShape ? quality.confidence_above_target_ratio : 0;
  const confidenceBelowTargetCount = Math.max(0, confidenceScoredSampleSize - confidenceAboveTargetCount);
  const targetHit = confidenceAboveTargetRatio >= confidenceTarget;
  const chartData = [
    {
      label: "confidence",
      aboveTarget: confidenceAboveTargetCount,
      belowTarget: confidenceBelowTargetCount,
    },
  ];

  const showSkeleton = isLoading && !hasShape;
  const showError = Boolean(errorMessage) && !hasShape;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Confidence Coverage</CardTitle>
          <CardDescription>Share of scored items above confidence target.</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton
            ? "Loading..."
            : isFetching
              ? "Updating..."
              : `${confidenceScoredSampleSize} scored - target ${Math.round(confidenceTarget * 100)}%`}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {showSkeleton ? (
          <div className="space-y-3 h-[320px] w-full">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : showError ? (
          <div className="h-[240px] w-full text-sm text-destructive flex items-center justify-center">
            Unable to load confidence coverage right now.
          </div>
        ) : !hasShape ? (
          <div className="h-[240px] w-full text-sm text-muted-foreground flex items-center justify-center">
            Confidence coverage metrics are not available in the current payload yet.
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
                          {formatPct(confidenceAboveTargetRatio)}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 12}
                          className="fill-muted-foreground text-xs"
                        >
                          coverage
                        </tspan>
                      </text>
                    );
                  }}
                />
              </PolarRadiusAxis>
              <RadialBar
                dataKey="aboveTarget"
                stackId="a"
                cornerRadius={6}
                fill="var(--chart-3)"
                className="stroke-transparent stroke-2"
              />
              <RadialBar
                dataKey="belowTarget"
                stackId="a"
                cornerRadius={6}
                fill="var(--chart-5)"
                className="stroke-transparent stroke-2"
              />
            </RadialBarChart>
          </ChartContainer>
        )}
      </CardContent>
      {!showSkeleton && !showError && hasShape ? (
        <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">
            {targetHit ? "Coverage is meeting target." : "Coverage is below target."}
          </div>
          <div>
            {confidenceAboveTargetCount.toLocaleString()} of {confidenceScoredSampleSize.toLocaleString()} scored
            items are above target confidence.
          </div>
        </CardFooter>
      ) : null}
    </Card>
  );
}

"use client"

import { CartesianGrid, Line, LineChart, XAxis } from "recharts"
import type { MemoryRetrievalTimeseriesPoint, RetrievalTuningStatus } from "@/hooks/useMemory"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"

interface ChartMemoryQualityLinesProps {
  points: MemoryRetrievalTimeseriesPoint[]
  tuningStatus?: RetrievalTuningStatus
  isLoading?: boolean
  isFetching?: boolean
  errorMessage?: string
}

const chartConfig = {
  hitRatePct: {
    label: "Hit rate",
    color: "hsl(var(--chart-3))",
  },
  similarityPct: {
    label: "Avg top similarity",
    color: "hsl(var(--chart-4))",
  },
} satisfies ChartConfig

export function ChartMemoryQualityLines({
  points,
  tuningStatus,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartMemoryQualityLinesProps) {
  const chartData = points.map((point) => ({
    date: point.date,
    hitRatePct: Math.round(point.hit_rate * 100),
    similarityPct: Math.round(point.avg_top_similarity * 100),
    p95LatencyMs: Math.round(point.p95_latency_ms),
  }))
  const latestLatency = chartData[chartData.length - 1]?.p95LatencyMs ?? 0
  const qualityPass = tuningStatus?.quality?.passes_guardrails ?? false
  const qualityLabel = tuningStatus
    ? qualityPass
      ? "quality pass"
      : "quality hold"
    : "quality n/a"
  const thresholdLabel = tuningStatus
    ? `${Math.round(tuningStatus.current_threshold * 100)}% threshold`
    : "threshold n/a"
  const latestDecision = tuningStatus?.recent_decisions?.[0]
  const latestReason = latestDecision?.reason ?? tuningStatus?.last_decision_reason ?? "n/a"
  const sourceMix = tuningStatus?.quality?.source_mix
  const sourceMixLabel = sourceMix
    ? `source mix u:${sourceMix.user_override_count} b:${sourceMix.weighted_blend_count} a:${sourceMix.agent_only_count} h:${sourceMix.heuristic_fallback_count}`
    : "source mix n/a"
  const hasData = chartData.length > 0
  const showSkeleton = isLoading && !hasData
  const showError = Boolean(errorMessage) && !hasData

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Memory Quality Trend</CardTitle>
          <CardDescription>
            Hit rate and similarity over time - {thresholdLabel} - {qualityLabel}
          </CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton
            ? "Loading..."
            : isFetching
              ? "Updating..."
              : `Latest p95 latency: ${latestLatency}ms`}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {showSkeleton ? (
          <div className="space-y-3 h-[300px] w-full">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : showError ? (
          <div className="h-[300px] w-full text-sm text-destructive flex items-center justify-center">
            Unable to load memory quality trends right now.
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] w-full text-sm text-muted-foreground flex items-center justify-center">
            No quality trend data yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Latest tuning decision: {latestDecision?.status ?? "n/a"} ({latestReason})
            </div>
            <div className="text-xs text-muted-foreground">
              {sourceMixLabel}
            </div>
            <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto">
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tickFormatter={(value: string) => {
                  const date = new Date(value)
                  return Number.isNaN(date.getTime())
                    ? value
                    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      const date = new Date(value)
                      return Number.isNaN(date.getTime())
                        ? String(value)
                        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                dataKey="hitRatePct"
                type="monotone"
                stroke="var(--chart-3)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                dataKey="similarityPct"
                type="monotone"
                stroke="var(--chart-4)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

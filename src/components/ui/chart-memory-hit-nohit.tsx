"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
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

interface ChartMemoryHitNoHitProps {
  points: MemoryRetrievalTimeseriesPoint[]
  tuningStatus?: RetrievalTuningStatus
  isLoading?: boolean
  isFetching?: boolean
  errorMessage?: string
}

const chartConfig = {
  hits: {
    label: "Hits",
    color: "hsl(var(--chart-3))",
  },
  noHits: {
    label: "No-hits",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig

export function ChartMemoryHitNoHit({
  points,
  tuningStatus,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartMemoryHitNoHitProps) {
  const chartData = points.map((point) => ({
    date: point.date,
    hits: point.hit_count,
    noHits: point.no_hit_count,
  }))
  const total = chartData.reduce((sum, row) => sum + row.hits + row.noHits, 0)
  const thresholdText = tuningStatus
    ? `${Math.round(tuningStatus.current_threshold * 100)}% similarity threshold`
    : "threshold n/a"
  const qualityScore = tuningStatus?.quality
    ? `${Math.round(tuningStatus.quality.quality_score * 100)} quality`
    : "quality n/a"
  const guardrailReason = tuningStatus?.quality?.reasons?.[0] ?? null
  const hasData = chartData.length > 0
  const showSkeleton = isLoading && !hasData
  const showError = Boolean(errorMessage) && !hasData

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Memory Hits vs No-hits</CardTitle>
          <CardDescription>Daily retrieval outcomes - {thresholdText} - {qualityScore}</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton ? "Loading..." : isFetching ? "Updating..." : `${total} total retrievals`}
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
            Unable to load retrieval outcomes right now.
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] w-full text-sm text-muted-foreground flex items-center justify-center">
            No retrieval events yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {guardrailReason
                ? `Guardrail hold reason: ${guardrailReason}`
                : "Guardrails clear"}
            </div>
            <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto">
            <BarChart accessibilityLayer data={chartData}>
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
              <Bar dataKey="hits" stackId="retrieval" fill="var(--chart-3)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="noHits" stackId="retrieval" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
            </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

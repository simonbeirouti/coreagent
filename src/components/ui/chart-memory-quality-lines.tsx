"use client"

import { CartesianGrid, Line, LineChart, XAxis } from "recharts"
import type { MemoryRetrievalTimeseriesPoint } from "@/hooks/useMemory"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

interface ChartMemoryQualityLinesProps {
  points: MemoryRetrievalTimeseriesPoint[]
  isLoading?: boolean
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

export function ChartMemoryQualityLines({ points, isLoading = false }: ChartMemoryQualityLinesProps) {
  const chartData = points.map((point) => ({
    date: point.date,
    hitRatePct: Math.round(point.hit_rate * 100),
    similarityPct: Math.round(point.avg_top_similarity * 100),
    p95LatencyMs: Math.round(point.p95_latency_ms),
  }))
  const latestLatency = chartData[chartData.length - 1]?.p95LatencyMs ?? 0

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Memory Quality Trend</CardTitle>
          <CardDescription>Hit rate and similarity over time</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {isLoading ? "Loading..." : `Latest p95 latency: ${latestLatency}ms`}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ChartContainer config={chartConfig} className="h-[300px] w-full aspect-auto">
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
      </CardContent>
    </Card>
  )
}

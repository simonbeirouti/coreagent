"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
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

interface ChartMemoryHitNoHitProps {
  points: MemoryRetrievalTimeseriesPoint[]
  isLoading?: boolean
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

export function ChartMemoryHitNoHit({ points, isLoading = false }: ChartMemoryHitNoHitProps) {
  const chartData = points.map((point) => ({
    date: point.date,
    hits: point.hit_count,
    noHits: point.no_hit_count,
  }))
  const total = chartData.reduce((sum, row) => sum + row.hits + row.noHits, 0)

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Memory Hits vs No-hits</CardTitle>
          <CardDescription>Daily retrieval outcomes</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {isLoading ? "Loading..." : `${total} total retrievals`}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ChartContainer config={chartConfig} className="h-[300px] w-full aspect-auto">
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
      </CardContent>
    </Card>
  )
}

"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import type { SkillPerformanceRating, SkillRatingTrendSeries } from "@/hooks/useAbilities"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

interface ChartSkillTrendAreaProps {
  series: SkillRatingTrendSeries[]
  fallbackRatings?: SkillPerformanceRating[]
  isLoading?: boolean
  isFetching?: boolean
  errorMessage?: string
}

const chartConfig = {
  first: {
    label: "Skill A",
    color: "hsl(var(--chart-1))",
  },
  second: {
    label: "Skill B",
    color: "hsl(var(--chart-4))",
  },
} satisfies ChartConfig

function toIsoDateLabel(input: string) {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return input.slice(0, 10)
  }
  return date.toISOString().slice(0, 10)
}

export function ChartSkillTrendArea({
  series,
  fallbackRatings = [],
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartSkillTrendAreaProps) {
  const [timeRange, setTimeRange] = React.useState("14d")

  const sortedByLatest = series
    .filter((entry) => entry.points.length > 0)
    .slice()
    .sort((a, b) => {
      const aLatest = a.points[a.points.length - 1]?.rating ?? 0
      const bLatest = b.points[b.points.length - 1]?.rating ?? 0
      return bLatest - aLatest
    })
  const firstSeries = sortedByLatest[0]
  const secondSeries = sortedByLatest[1]

  const dateMap = new Map<string, { date: string; first: number; second: number }>()
  for (const point of firstSeries?.points ?? []) {
    const date = toIsoDateLabel(point.timestamp)
    dateMap.set(date, { date, first: point.rating, second: 0 })
  }
  for (const point of secondSeries?.points ?? []) {
    const date = toIsoDateLabel(point.timestamp)
    const existing = dateMap.get(date) ?? { date, first: 0, second: 0 }
    existing.second = point.rating
    dateMap.set(date, existing)
  }
  const merged = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  const days = timeRange === "90d" ? 90 : timeRange === "30d" ? 30 : 14
  const referenceDate = merged.length > 0 ? new Date(merged[merged.length - 1].date) : new Date()
  const startDate = new Date(referenceDate)
  startDate.setDate(startDate.getDate() - days + 1)

  const filteredData = merged.filter((item) => {
    const date = new Date(item.date)
    return date >= startDate
  })

  const fallbackTopRatings = fallbackRatings
    .slice()
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 2)
  const fallbackChartData =
    fallbackTopRatings.length >= 1
      ? [
          {
            date: new Date().toISOString().slice(0, 10),
            first: Math.round((fallbackTopRatings[0]?.rating ?? 0) * 10) / 10,
            second:
              fallbackTopRatings.length > 1
                ? Math.round((fallbackTopRatings[1]?.rating ?? 0) * 10) / 10
                : 0,
          },
        ]
      : []
  const hasTrendData = filteredData.length > 0
  const chartData = hasTrendData ? filteredData : fallbackChartData
  const hasData = chartData.length > 0
  const showSkeleton = isLoading && !hasData
  const showError = Boolean(errorMessage) && !hasData

  const dynamicConfig = {
    ...chartConfig,
    first: {
      ...chartConfig.first,
      label: firstSeries?.skill_name ?? fallbackTopRatings[0]?.skill_name ?? "Primary skill",
    },
    second: {
      ...chartConfig.second,
      label: secondSeries?.skill_name ?? fallbackTopRatings[1]?.skill_name ?? "Secondary skill",
    },
  } satisfies ChartConfig

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Skill Trend Highlights</CardTitle>
          <CardDescription>Top skill trajectories by rating</CardDescription>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {showSkeleton ? "Loading..." : isFetching ? "Updating..." : " "}
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[160px] rounded-lg sm:ml-auto" aria-label="Select time range">
            <SelectValue placeholder="Last 14 days" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="90d" className="rounded-lg">
              Last 90 days
            </SelectItem>
            <SelectItem value="30d" className="rounded-lg">
              Last 30 days
            </SelectItem>
            <SelectItem value="14d" className="rounded-lg">
              Last 14 days
            </SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {showSkeleton ? (
          <div className="space-y-3 h-[280px] w-full">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[240px] w-full" />
          </div>
        ) : showError ? (
          <div className="h-[280px] w-full text-sm text-destructive flex items-center justify-center">
            Unable to load skill trends right now.
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[280px] w-full text-sm text-muted-foreground flex items-center justify-center">
            No trend snapshots yet.
          </div>
        ) : (
          <ChartContainer config={dynamicConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillFirstSkill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillSecondSkill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-4)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--chart-4)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
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
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="first"
                type="natural"
                fill="url(#fillFirstSkill)"
                stroke="var(--chart-1)"
                strokeWidth={2}
              />
              <Area
                dataKey="second"
                type="natural"
                fill="url(#fillSecondSkill)"
                stroke="var(--chart-4)"
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
        {!isLoading && !hasTrendData && fallbackChartData.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing current top skill levels. Trend lines will appear after additional snapshots.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

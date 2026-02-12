"use client"

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts"
import type { TraitState } from "@/hooks/useFeedback"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"

interface ChartTraitStateRadarProps {
  traitState?: TraitState
  isLoading?: boolean
  isFetching?: boolean
  errorMessage?: string
}

const chartConfig = {
  value: {
    label: "Trait score",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

function toFinitePercent(value: unknown): number {
  const next = typeof value === "number" ? value : Number(value)
  const safe = Number.isFinite(next) ? next : 0
  return Math.round(safe * 100)
}

export function ChartTraitStateRadar({
  traitState,
  isLoading = false,
  isFetching = false,
  errorMessage,
}: ChartTraitStateRadarProps) {
  const chartData = traitState
    ? [
        { trait: "Helpfulness", value: toFinitePercent(traitState.helpfulness) },
        { trait: "Formality", value: toFinitePercent(traitState.formality) },
        { trait: "Verbosity", value: toFinitePercent(traitState.verbosity) },
        { trait: "Proactivity", value: toFinitePercent(traitState.proactivity) },
        { trait: "Creativity", value: toFinitePercent(traitState.creativity) },
        { trait: "Empathy", value: toFinitePercent(traitState.empathy) },
      ]
    : [
        { trait: "Helpfulness", value: 0 },
        { trait: "Formality", value: 0 },
        { trait: "Verbosity", value: 0 },
        { trait: "Proactivity", value: 0 },
        { trait: "Creativity", value: 0 },
        { trait: "Empathy", value: 0 },
      ]
  const hasData = Boolean(traitState)
  const showSkeleton = isLoading && !hasData
  const showError = Boolean(errorMessage) && !hasData

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Adaptive Trait State</CardTitle>
          <CardDescription>Current personality shape</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {showSkeleton ? "Loading trait state..." : isFetching ? "Updating..." : "Hover to inspect values"}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1">
        {showSkeleton ? (
          <div className="flex h-full min-h-[300px] w-full flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-full min-h-[260px] w-full" />
          </div>
        ) : showError ? (
          <div className="flex h-full min-h-[300px] w-full items-center justify-center text-sm text-destructive">
            Unable to load adaptive trait state right now.
          </div>
        ) : traitState ? (
          <ChartContainer config={chartConfig} className="mx-auto h-full min-h-[300px] w-full aspect-auto">
            <RadarChart data={chartData}>
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <PolarAngleAxis dataKey="trait" />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} />
              <PolarGrid />
              <Radar
                dataKey="value"
                fill="var(--chart-2)"
                fillOpacity={0.6}
                dot={{
                  r: 4,
                  fillOpacity: 1,
                }}
              />
            </RadarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-full min-h-[300px] w-full items-center justify-center text-sm text-muted-foreground">
            Trait state is not available yet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

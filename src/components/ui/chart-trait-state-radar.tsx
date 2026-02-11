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

interface ChartTraitStateRadarProps {
  traitState?: TraitState
  isLoading?: boolean
}

const chartConfig = {
  value: {
    label: "Trait score",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

export function ChartTraitStateRadar({ traitState, isLoading = false }: ChartTraitStateRadarProps) {
  const chartData = traitState
    ? [
        { trait: "Helpfulness", value: Math.round(traitState.helpfulness * 100) },
        { trait: "Formality", value: Math.round(traitState.formality * 100) },
        { trait: "Verbosity", value: Math.round(traitState.verbosity * 100) },
        { trait: "Proactivity", value: Math.round(traitState.proactivity * 100) },
        { trait: "Creativity", value: Math.round(traitState.creativity * 100) },
        { trait: "Empathy", value: Math.round(traitState.empathy * 100) },
      ]
    : [
        { trait: "Helpfulness", value: 0 },
        { trait: "Formality", value: 0 },
        { trait: "Verbosity", value: 0 },
        { trait: "Proactivity", value: 0 },
        { trait: "Creativity", value: 0 },
        { trait: "Empathy", value: 0 },
      ]

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex items-center justify-between">
        <div className="space-y-2">
          <CardTitle>Adaptive Trait State</CardTitle>
          <CardDescription>Current personality shape</CardDescription>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {isLoading ? "Loading trait state..." : "Hover to inspect values"}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ChartContainer config={chartConfig} className="mx-auto h-[300px] w-full aspect-auto">
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
      </CardContent>
    </Card>
  )
}

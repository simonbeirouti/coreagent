"use client"

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts"
import type { AgentAbility } from "@/hooks/useAbilities"

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart"

interface ChartRadarDotsProps {
    abilities: AgentAbility[]
    isLoading?: boolean
}

const chartConfig = {
    proficiency: {
        label: "Proficiency",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig

export function ChartRadarDots({ abilities, isLoading = false }: ChartRadarDotsProps) {
    const abilityData = abilities
        .slice()
        .sort((a, b) => b.proficiency - a.proficiency)
        .slice(0, 6)
        .map((ability) => ({
            skill: ability.ability_name,
            proficiency: Math.round(ability.proficiency * 100),
        }))

    // TODO: Replace fallback values with dedicated skill-domain metrics when available.
    const fallbackData = [
        { skill: "Conversation", proficiency: 0 },
        { skill: "Memory", proficiency: 0 },
        { skill: "Reasoning", proficiency: 0 },
        { skill: "Voice", proficiency: 0 },
        { skill: "Vision", proficiency: 0 },
    ]

    const chartData = abilityData.length > 0 ? abilityData : fallbackData

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex items-center justify-between">
                <div className="space-y-2">
                    <CardTitle>Skill Proficiency</CardTitle>
                    <CardDescription>Top tracked abilities by proficiency</CardDescription>
                </div>
                <div className="text-sm text-muted-foreground whitespace-nowrap">
                    {isLoading
                        ? "Loading skill proficiency..."
                        : abilities.length > 0
                            ? `${abilities.length} tracked abilities`
                            : "No tracked abilities yet"}
                </div>
            </CardHeader>
            <CardContent className="pb-0 flex-1">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto h-[320px] w-full aspect-auto"
                >
                    <RadarChart data={chartData}>
                        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                        <PolarAngleAxis dataKey="skill" />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} />
                        <PolarGrid />
                        <Radar
                            dataKey="proficiency"
                            fill="var(--color-proficiency)"
                            fillOpacity={0.6}
                            dot={{
                                r: 4,
                                fillOpacity: 1,
                            }}
                        />
                    </RadarChart>
                </ChartContainer>
                {abilities.length > 0 ? (
                    <div className="mt-4 space-y-1 text-sm">
                        {abilityData.map((ability) => (
                            <div key={ability.skill} className="flex items-center justify-between">
                                <span className="text-muted-foreground">{ability.skill}</span>
                                <span className="font-medium">{ability.proficiency}%</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    )
}

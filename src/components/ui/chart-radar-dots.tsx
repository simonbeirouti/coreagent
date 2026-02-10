"use client"

import { LabelList, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts"
import type { SkillPerformanceRating } from "@/hooks/useAbilities"

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
    ratings: SkillPerformanceRating[]
    isLoading?: boolean
    errorMessage?: string
}

const chartConfig = {
    rating: {
        label: "Score",
        color: "hsl(var(--chart-2))",
    },
} satisfies ChartConfig

export function ChartRadarDots({
    ratings,
    isLoading = false,
    errorMessage,
}: ChartRadarDotsProps) {
    const ratingData = ratings
        .slice()
        .sort((a, b) => b.rating - a.rating)
        .map((entry) => ({
            skill: entry.skill_name,
            rating: Math.round(entry.rating),
            confidence: Math.round(entry.confidence_score * 100),
        }))

    const fallbackData = [
        { skill: "Chat", rating: 0, confidence: 0 },
        { skill: "Voice", rating: 0, confidence: 0 },
        { skill: "Screenshot", rating: 0, confidence: 0 },
    ]

    const chartData = ratingData.length > 0 ? ratingData : fallbackData

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex items-center justify-between">
                <div className="space-y-2">
                    <CardTitle>Core Skill Performance</CardTitle>
                    <CardDescription>Balanced rating for chat, voice, and screenshot</CardDescription>
                </div>
                <div className="text-sm text-muted-foreground whitespace-nowrap">
                    {isLoading
                        ? "Loading skill ratings..."
                        : errorMessage
                            ? "Skill ratings unavailable"
                        : ratings.length > 0
                            ? `${ratings.length} rated skills`
                            : "No rating data yet"}
                </div>
            </CardHeader>
            <CardContent className="flex-1 -mb-28">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto h-full w-full aspect-auto"
                >
                    <RadarChart data={chartData}>
                        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                        <PolarAngleAxis dataKey="skill" />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} />
                        <PolarGrid />
                        <Radar
                            dataKey="rating"
                            fill="var(--color-rating)"
                            fillOpacity={0.6}
                            dot={{
                                r: 4,
                                fillOpacity: 1,
                            }}
                        >
                            <LabelList
                                dataKey="rating"
                                position="outside"
                                formatter={(value: number) => `${value}%`}
                                className="fill-foreground text-xs font-medium"
                            />
                        </Radar>
                    </RadarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}

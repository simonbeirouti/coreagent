"use client"

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts"
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
import { Skeleton } from "@/components/ui/skeleton"

interface CoreSkillPerformanceProps {
    ratings: SkillPerformanceRating[]
    isLoading?: boolean
    isFetching?: boolean
    errorMessage?: string
}

const chartConfig = {
    rating: {
        label: "Score",
        color: "hsl(var(--chart-2))",
    },
} satisfies ChartConfig

export function CoreSkillPerformance({
    ratings,
    isLoading = false,
    isFetching = false,
    errorMessage,
}: CoreSkillPerformanceProps) {
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
    const hasData = ratingData.length > 0
    const showSkeleton = isLoading && !hasData
    const showError = Boolean(errorMessage) && !hasData

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex items-center justify-between">
                <div className="space-y-2">
                    <CardTitle>Core Skill Performance</CardTitle>
                    <CardDescription>Balanced rating for chat, voice, and screenshot</CardDescription>
                </div>
                <div className="text-sm text-muted-foreground whitespace-nowrap">
                    {showSkeleton
                        ? "Loading skill ratings..."
                        : isFetching
                            ? "Updating..."
                        : errorMessage
                            ? "Skill ratings unavailable"
                            : ratings.length > 0
                                ? `${ratings.length} rated skills`
                                : "No rating data yet"}
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
                        Unable to load core skill ratings right now.
                    </div>
                ) : (
                    <ChartContainer config={chartConfig} className="mx-auto h-full min-h-[300px] w-full aspect-auto">
                        <RadarChart data={chartData}>
                            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                            <PolarAngleAxis dataKey="skill" />
                            <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} />
                            <PolarGrid />
                            <Radar
                                dataKey="rating"
                                fill="var(--chart-2)"
                                fillOpacity={0.6}
                                dot={{
                                    r: 4,
                                    fillOpacity: 1,
                                }}
                            />
                        </RadarChart>
                    </ChartContainer>
                )}
            </CardContent>
        </Card>
    )
}

"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import type { FeedbackMonthlyPoint } from "@/hooks/useFeedback"

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"

interface SentimentFeedbackProps {
    monthlyData: FeedbackMonthlyPoint[]
    positive: number
    negative: number
    isLoading?: boolean
    isFetching?: boolean
    errorMessage?: string
}

const chartConfig = {
    positive: {
        label: "Positive",
        color: "hsl(var(--chart-3))",
    },
    negative: {
        label: "Negative",
        color: "hsl(var(--chart-5))",
    },
} satisfies ChartConfig

export function SentimentFeedback({
    monthlyData,
    positive,
    negative,
    isLoading = false,
    isFetching = false,
    errorMessage,
}: SentimentFeedbackProps) {
    const hasData = monthlyData.length > 0
    const showSkeleton = isLoading && !hasData
    const showError = Boolean(errorMessage) && !hasData
    const total = positive + negative
    const totalLabel = showSkeleton ? "Loading feedback..." : isFetching ? "Updating..." : `${total} total ratings`

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex items-center justify-between">
                <div className="space-y-2">
                    <CardTitle>Sentiment Feedback</CardTitle>
                    <CardDescription>Monthly sentiment feedback distribution</CardDescription>
                </div>
                <div className="text-sm text-muted-foreground whitespace-nowrap">{totalLabel}</div>
            </CardHeader>
            <CardContent className="flex-1">
                {showSkeleton ? (
                    <div className="space-y-3 h-[320px] w-full">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="h-[276px] w-full" />
                    </div>
                ) : showError ? (
                    <div className="h-[320px] w-full text-sm text-destructive flex items-center justify-center">
                        Unable to load sentiment feedback right now.
                    </div>
                ) : monthlyData.length === 0 ? (
                    <div className="h-[320px] w-full text-sm text-muted-foreground flex items-center justify-center">
                        No monthly feedback data yet.
                    </div>
                ) : (
                    <ChartContainer config={chartConfig} className="h-[320px] w-full aspect-auto">
                        <BarChart accessibilityLayer data={monthlyData}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="month"
                                tickLine={false}
                                tickMargin={10}
                                axisLine={false}
                            />
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <ChartLegend content={<ChartLegendContent />} />
                            <Bar dataKey="positive" stackId="a" fill="var(--chart-3)" radius={[0, 0, 4, 4]} />
                            <Bar dataKey="negative" stackId="a" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ChartContainer>
                )}
            </CardContent>
        </Card>
    )
}

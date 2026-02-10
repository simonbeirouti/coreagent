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

interface ChatBarStackedProps {
    monthlyData: FeedbackMonthlyPoint[]
    positive: number
    negative: number
    isLoading?: boolean
}

const chartConfig = {
    positive: {
        label: "Positive",
        color: "hsl(var(--chart-2))",
    },
    negative: {
        label: "Negative",
        color: "hsl(var(--destructive))",
    },
} satisfies ChartConfig

export function ChatBarStacked({ monthlyData, positive, negative, isLoading = false }: ChatBarStackedProps) {
    const total = positive + negative
    const totalLabel = isLoading ? "Loading feedback..." : `${total} total ratings`

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
                        <Bar dataKey="positive" stackId="a" fill="var(--chart-2)" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="negative" stackId="a" fill="var(--destructive)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}

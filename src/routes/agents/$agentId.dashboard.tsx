import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAgentAbilities } from '@/hooks/useAbilities';
import { useFeedbackMonthly, useFeedbackStats } from '@/hooks/useFeedback';
import { ChatBarStacked } from '@/components/ui/chat-bar-stacked';
import { ChartRadarDots } from '@/components/ui/chart-radar-dots';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/agents/$agentId/dashboard')({
  component: AgentDashboardPage,
});

function AgentDashboardPage() {
  const { agentId } = Route.useParams();
  const { data: abilities = [], isLoading: isAbilitiesLoading } = useAgentAbilities(agentId);
  const { data: feedbackStats, isLoading: isFeedbackLoading } = useFeedbackStats(agentId);
  const { data: feedbackMonthly = [], isLoading: isFeedbackMonthlyLoading } = useFeedbackMonthly(agentId);

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Tracked Skills
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {isAbilitiesLoading ? '...' : abilities.length}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ThumbsUp className="h-4 w-4" />
              Positive Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {isFeedbackLoading ? '...' : (feedbackStats?.positive ?? 0)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ThumbsDown className="h-4 w-4" />
              Negative Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {isFeedbackLoading ? '...' : (feedbackStats?.negative ?? 0)}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-fr gap-4 items-stretch">
        <ChatBarStacked
          monthlyData={feedbackMonthly}
          positive={feedbackStats?.positive ?? 0}
          negative={feedbackStats?.negative ?? 0}
          isLoading={isFeedbackLoading || isFeedbackMonthlyLoading}
        />
        <ChartRadarDots abilities={abilities} isLoading={isAbilitiesLoading} />
      </div>
    </div>
  );
}


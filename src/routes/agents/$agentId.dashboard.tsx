import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAgentSkillRatings } from '@/hooks/useAbilities';
import { useFeedbackMonthly, useFeedbackStats } from '@/hooks/useFeedback';
import { ChatBarStacked } from '@/components/ui/chat-bar-stacked';
import { ChartRadarDots } from '@/components/ui/chart-radar-dots';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/agents/$agentId/dashboard')({
  component: AgentDashboardPage,
});

function AgentDashboardPage() {
  const { agentId } = Route.useParams();
  const {
    data: skillRatings = [],
    isLoading: isSkillRatingsLoading,
    error: skillRatingsError,
  } = useAgentSkillRatings(agentId);
  const { data: feedbackStats, isLoading: isFeedbackLoading } = useFeedbackStats(agentId);
  const { data: feedbackMonthly = [], isLoading: isFeedbackMonthlyLoading } = useFeedbackMonthly(agentId);
  const sortedRatings = skillRatings.slice().sort((a, b) => b.rating - a.rating);
  const topSkill = sortedRatings[0];
  const lowestSkill = sortedRatings[sortedRatings.length - 1];
  const overallRating =
    sortedRatings.length > 0
      ? Math.round(
          sortedRatings.reduce((total, entry) => total + entry.rating, 0) / sortedRatings.length
        )
      : 0;

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Overall Skill Rating
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-semibold">
              {isSkillRatingsLoading ? '...' : `${overallRating}%`}
            </div>
            {!isSkillRatingsLoading && topSkill && lowestSkill ? (
              <div className="text-xs text-muted-foreground">
                Top: {topSkill.skill_name} ({Math.round(topSkill.rating)}%) | Needs work:{' '}
                {lowestSkill.skill_name} ({Math.round(lowestSkill.rating)}%)
              </div>
            ) : null}
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
        <ChartRadarDots
          ratings={skillRatings}
          isLoading={isSkillRatingsLoading}
          errorMessage={skillRatingsError ? String(skillRatingsError) : undefined}
        />
      </div>
    </div>
  );
}


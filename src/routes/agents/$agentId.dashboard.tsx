import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAgentSkillRatingTrends, useAgentSkillRatings } from '@/hooks/useAbilities';
import {
  useFeedbackMonthly,
  useFeedbackStats,
  usePersonalityAdjustments,
  useTraitState,
} from '@/hooks/useFeedback';
import { useMemoryQualityTimeseries } from '@/hooks/useMemory';
import { SentimentFeedback } from '@/components/ui/chart-sentiment-feedback';
import { CoreSkillPerformance } from '@/components/ui/chart-core-skill-performance';
import { ChartMemoryHitNoHit } from '@/components/ui/chart-memory-hit-nohit';
import { ChartMemoryQualityLines } from '@/components/ui/chart-memory-quality-lines';
import { ChartSkillTrendArea } from '@/components/ui/chart-skill-trend-area';
import { ChartTraitStateRadar } from '@/components/ui/chart-trait-state-radar';
import { PersonalityEvolution } from '@/components/agent/personality-evolution';
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
  const { data: traitState, isLoading: isTraitStateLoading } = useTraitState(agentId);
  const { data: adjustments = [], isLoading: isAdjustmentsLoading } = usePersonalityAdjustments(agentId);
  const { data: skillTrends = [], isLoading: isSkillTrendsLoading } = useAgentSkillRatingTrends(agentId, 14);
  const { data: memoryTimeseries = [], isLoading: isMemoryTimeseriesLoading } =
    useMemoryQualityTimeseries(agentId, 14);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    console.groupCollapsed(`[DashboardData] agent=${agentId}`);
    console.log('ChartSkillTrendArea.series', skillTrends);
    console.log('ChartSkillTrendArea.fallbackRatings', skillRatings);
    console.log('ChartMemoryHitNoHit.points', memoryTimeseries);
    console.log('ChartMemoryQualityLines.points', memoryTimeseries);
    console.log('ChartTraitStateRadar.traitState', traitState);
    console.log('PersonalityEvolution.adjustments', adjustments);
    console.log('PersonalityEvolution.traitState', traitState);
    console.log('SentimentFeedback.monthlyData', feedbackMonthly);
    console.log('SentimentFeedback.stats', feedbackStats);
    console.log('CoreSkillPerformance.ratings', skillRatings);
    console.groupEnd();
  }, [
    agentId,
    adjustments,
    feedbackMonthly,
    feedbackStats,
    memoryTimeseries,
    skillRatings,
    skillTrends,
    traitState,
  ]);

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <ChartSkillTrendArea
        series={skillTrends}
        fallbackRatings={skillRatings}
        isLoading={isSkillTrendsLoading}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <ChartMemoryHitNoHit points={memoryTimeseries} isLoading={isMemoryTimeseriesLoading} />
        <ChartMemoryQualityLines points={memoryTimeseries} isLoading={isMemoryTimeseriesLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartTraitStateRadar
          traitState={traitState}
          isLoading={isTraitStateLoading || isAdjustmentsLoading}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Personality Evolution Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonalityEvolution
              adjustments={adjustments}
              traitState={traitState}
              isLoading={isAdjustmentsLoading}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-fr gap-4 items-stretch">
        <SentimentFeedback
          monthlyData={feedbackMonthly}
          positive={feedbackStats?.positive ?? 0}
          negative={feedbackStats?.negative ?? 0}
          isLoading={isFeedbackLoading || isFeedbackMonthlyLoading}
        />
        <CoreSkillPerformance
          ratings={skillRatings}
          isLoading={isSkillRatingsLoading}
          errorMessage={skillRatingsError ? String(skillRatingsError) : undefined}
        />
      </div>
    </div>
  );
}


import { createFileRoute } from '@tanstack/react-router';
import { useAgentSkillRatingTrends, useAgentSkillRatings } from '@/hooks/useAbilities';
import {
  useFeedbackMonthly,
  useFeedbackStats,
  usePersonalityAdjustments,
  useTraitState,
} from '@/hooks/useFeedback';
import { useMemoryQualityTimeseries, useRetrievalTuningStatus } from '@/hooks/useMemory';
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
    isFetching: isSkillRatingsFetching,
    error: skillRatingsError,
  } = useAgentSkillRatings(agentId);
  const {
    data: feedbackStats,
    isLoading: isFeedbackLoading,
    isFetching: isFeedbackFetching,
    error: feedbackStatsError,
  } = useFeedbackStats(agentId);
  const {
    data: feedbackMonthly = [],
    isLoading: isFeedbackMonthlyLoading,
    isFetching: isFeedbackMonthlyFetching,
    error: feedbackMonthlyError,
  } = useFeedbackMonthly(agentId);
  const {
    data: traitState,
    isLoading: isTraitStateLoading,
    isFetching: isTraitStateFetching,
    error: traitStateError,
  } = useTraitState(agentId);
  const {
    data: adjustments = [],
    isLoading: isAdjustmentsLoading,
    isFetching: isAdjustmentsFetching,
    error: adjustmentsError,
  } = usePersonalityAdjustments(agentId);
  const {
    data: skillTrends = [],
    isLoading: isSkillTrendsLoading,
    isFetching: isSkillTrendsFetching,
    error: skillTrendsError,
  } = useAgentSkillRatingTrends(agentId, 14);
  const {
    data: memoryTimeseries = [],
    isLoading: isMemoryTimeseriesLoading,
    isFetching: isMemoryTimeseriesFetching,
    error: memoryTimeseriesError,
  } =
    useMemoryQualityTimeseries(agentId, 14);
  const {
    data: retrievalTuningStatus,
    isLoading: isTuningLoading,
    isFetching: isTuningFetching,
    error: tuningError,
  } = useRetrievalTuningStatus(agentId);

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <ChartSkillTrendArea
        series={skillTrends}
        fallbackRatings={skillRatings}
        isLoading={isSkillTrendsLoading}
        isFetching={isSkillTrendsFetching}
        errorMessage={skillTrendsError ? String(skillTrendsError) : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <ChartMemoryHitNoHit
          points={memoryTimeseries}
          tuningStatus={retrievalTuningStatus}
          isLoading={isMemoryTimeseriesLoading || isTuningLoading}
          isFetching={isMemoryTimeseriesFetching || isTuningFetching}
          errorMessage={
            memoryTimeseriesError || tuningError
              ? String(memoryTimeseriesError ?? tuningError)
              : undefined
          }
        />
        <ChartMemoryQualityLines
          points={memoryTimeseries}
          tuningStatus={retrievalTuningStatus}
          isLoading={isMemoryTimeseriesLoading || isTuningLoading}
          isFetching={isMemoryTimeseriesFetching || isTuningFetching}
          errorMessage={
            memoryTimeseriesError || tuningError
              ? String(memoryTimeseriesError ?? tuningError)
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartTraitStateRadar
          traitState={traitState}
          isLoading={isTraitStateLoading}
          isFetching={isTraitStateFetching}
          errorMessage={traitStateError ? String(traitStateError) : undefined}
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
              isFetching={isAdjustmentsFetching}
              errorMessage={adjustmentsError ? String(adjustmentsError) : undefined}
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
          isFetching={isFeedbackFetching || isFeedbackMonthlyFetching}
          errorMessage={
            feedbackStatsError || feedbackMonthlyError
              ? String(feedbackStatsError ?? feedbackMonthlyError)
              : undefined
          }
        />
        <CoreSkillPerformance
          ratings={skillRatings}
          isLoading={isSkillRatingsLoading}
          isFetching={isSkillRatingsFetching}
          errorMessage={skillRatingsError ? String(skillRatingsError) : undefined}
        />
      </div>
    </div>
  );
}


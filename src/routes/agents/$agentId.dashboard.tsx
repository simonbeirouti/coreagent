import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
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
import { ChartSourceMixBars } from '@/components/ui/chart-source-mix-bars';
import { ChartConfidenceCoverage } from '@/components/ui/chart-confidence-coverage';
import { ChartGuardrailOutcomes } from '@/components/ui/chart-guardrail-outcomes';
import { ChartSkillTrendArea } from '@/components/ui/chart-skill-trend-area';
import { ChartTraitStateRadar } from '@/components/ui/chart-trait-state-radar';
import { PersonalityEvolution } from '@/components/agent/personality-evolution';
import { Card, CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/agents/$agentId/dashboard')({
  component: AgentDashboardPage,
});

function AgentDashboardPage() {
  const { agentId } = Route.useParams();
  const [skillTrendDays, setSkillTrendDays] = useState<14 | 30 | 90>(14);
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
  } = useAgentSkillRatingTrends(agentId, skillTrendDays);
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSkillTrendArea
          series={skillTrends}
          fallbackRatings={skillRatings}
          timeRangeDays={skillTrendDays}
          onTimeRangeDaysChange={setSkillTrendDays}
          isLoading={isSkillTrendsLoading}
          isFetching={isSkillTrendsFetching}
          errorMessage={skillTrendsError ? String(skillTrendsError) : undefined}
        />
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
        <CoreSkillPerformance
          ratings={skillRatings}
          isLoading={isSkillRatingsLoading}
          isFetching={isSkillRatingsFetching}
          errorMessage={skillRatingsError ? String(skillRatingsError) : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSourceMixBars
          tuningStatus={retrievalTuningStatus}
          isLoading={isTuningLoading}
          isFetching={isTuningFetching}
          errorMessage={tuningError ? String(tuningError) : undefined}
        />

        <Card>
          <CardContent>
            <PersonalityEvolution
              adjustments={adjustments}
              traitState={traitState}
              latestDecision={retrievalTuningStatus?.recent_decisions?.[0]}
              isLoading={isAdjustmentsLoading}
              isFetching={isAdjustmentsFetching}
              errorMessage={adjustmentsError ? String(adjustmentsError) : undefined}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartConfidenceCoverage
          tuningStatus={retrievalTuningStatus}
          isLoading={isTuningLoading}
          isFetching={isTuningFetching}
          errorMessage={tuningError ? String(tuningError) : undefined}
        />
        <ChartGuardrailOutcomes
          tuningStatus={retrievalTuningStatus}
          isLoading={isTuningLoading}
          isFetching={isTuningFetching}
          errorMessage={tuningError ? String(tuningError) : undefined}
        />
      </div>

    </div>
  );
}


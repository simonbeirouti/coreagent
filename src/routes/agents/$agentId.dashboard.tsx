import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Brain, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAgentAbilities } from '@/hooks/useAbilities';
import { useAnalyzeFeedbackPatterns, useFeedbackStats } from '@/hooks/useFeedback';
import { ProficiencyChart } from '@/components/skills/proficiency-chart';
import { PersonalityEvolution } from '@/components/agent/personality-evolution';

export const Route = createFileRoute('/agents/$agentId/dashboard')({
  component: AgentDashboardPage,
});

function AgentDashboardPage() {
  const { agentId } = Route.useParams();
  const { data: abilities = [], isLoading: isAbilitiesLoading } = useAgentAbilities(agentId);
  const { data: feedbackStats, isLoading: isFeedbackLoading } = useFeedbackStats(agentId);
  const analyzeFeedback = useAnalyzeFeedbackPatterns(agentId);

  return (
    <div className="p-4 space-y-4">
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
              <MessageSquare className="h-4 w-4" />
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
              <Brain className="h-4 w-4" />
              Negative Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {isFeedbackLoading ? '...' : (feedbackStats?.negative ?? 0)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skill Proficiency</CardTitle>
        </CardHeader>
        <CardContent>
          <ProficiencyChart abilities={abilities} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Personality Evolution</CardTitle>
          <Button
            variant="outline"
            onClick={() => analyzeFeedback.mutate()}
            disabled={analyzeFeedback.isPending}
          >
            {analyzeFeedback.isPending ? 'Analyzing...' : 'Analyze Feedback'}
          </Button>
        </CardHeader>
        <CardContent>
          <PersonalityEvolution agentId={agentId} />
        </CardContent>
      </Card>
    </div>
  );
}


import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubmitFeedback, type FeedbackDimension, type FeedbackRating } from '@/hooks/useFeedback';
import { toast } from 'sonner';

interface MessageFeedbackProps {
  agentId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  selected?: Partial<Record<FeedbackDimension, FeedbackRating>>;
  mode?: 'inline' | 'menu';
}

export function MessageFeedback({
  agentId,
  conversationId,
  messageId,
  userId,
  selected = {},
  mode = 'inline',
}: MessageFeedbackProps) {
  const submitFeedback = useSubmitFeedback(agentId);

  const handleFeedback = (dimension: FeedbackDimension, rating: FeedbackRating) => {
    const feedbackType = rating === 'up' ? 'positive' : 'negative';
    submitFeedback.mutate(
      {
        message_id: messageId,
        user_id: userId,
        feedback_type: feedbackType,
        feedback_category: dimension,
        dimension_ratings: {
          [dimension]: rating,
        },
        conversation_id: conversationId,
      },
      {
        onSuccess: () => {
          toast.success('Feedback saved');
        },
        onError: (error) => {
          console.error('Failed to submit feedback:', error);
          toast.error('Failed to save feedback');
        },
      }
    );
  };

  const dimensions: { key: FeedbackDimension; label: string }[] = [
    { key: 'helpfulness', label: 'Helpfulness' },
    { key: 'accuracy', label: 'Accuracy' },
    { key: 'tone', label: 'Tone' },
    { key: 'verbosity', label: 'Verbosity' },
  ];

  return (
    <div className={mode === 'menu' ? 'space-y-1 min-w-44' : 'mt-2 space-y-1'}>
      {dimensions.map((dimension) => {
        const current = selected[dimension.key];
        const showButtons = mode === 'menu' && !current
          ? 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100'
          : 'opacity-100';
        return (
          <div key={dimension.key} className="group/row flex items-center justify-between gap-2 rounded-sm px-2 py-1 hover:bg-accent/60">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {dimension.label}
            </span>
            <div className={`flex items-center gap-1 transition-opacity ${showButtons}`}>
              <Button
                size="icon"
                variant={current === 'up' ? 'default' : 'ghost'}
                className="group/thumb h-5 w-5"
                onClick={() => handleFeedback(dimension.key, 'up')}
                title={`${dimension.label}: good`}
              >
                <ThumbsUp
                  className={`h-3 w-3 transition-colors ${
                    current === 'up' ? 'fill-current' : 'group-hover/thumb:fill-current'
                  }`}
                />
              </Button>
              <Button
                size="icon"
                variant={current === 'down' ? 'destructive' : 'ghost'}
                className="group/thumb h-5 w-5"
                onClick={() => handleFeedback(dimension.key, 'down')}
                title={`${dimension.label}: needs work`}
              >
                <ThumbsDown
                  className={`h-3 w-3 transition-colors ${
                    current === 'down' ? 'fill-current' : 'group-hover/thumb:fill-current'
                  }`}
                />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


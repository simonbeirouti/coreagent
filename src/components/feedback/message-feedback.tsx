import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubmitFeedback, type FeedbackType } from '@/hooks/useFeedback';
import { toast } from 'sonner';

interface MessageFeedbackProps {
  agentId: string;
  messageId: string;
  userId: string;
}

export function MessageFeedback({ agentId, messageId, userId }: MessageFeedbackProps) {
  const [selected, setSelected] = useState<FeedbackType | null>(null);
  const submitFeedback = useSubmitFeedback(agentId);

  const handleFeedback = async (feedbackType: FeedbackType) => {
    try {
      await submitFeedback.mutateAsync({
        message_id: messageId,
        user_id: userId,
        feedback_type: feedbackType,
      });
      setSelected(feedbackType);
      toast.success('Feedback saved');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      toast.error('Failed to save feedback');
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1">
      <Button
        size="icon"
        variant={selected === 'positive' ? 'default' : 'ghost'}
        className="h-6 w-6"
        onClick={() => handleFeedback('positive')}
        title="Helpful response"
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        size="icon"
        variant={selected === 'negative' ? 'destructive' : 'ghost'}
        className="h-6 w-6"
        onClick={() => handleFeedback('negative')}
        title="Not helpful"
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
    </div>
  );
}


import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useChunkedTranscription } from '@/hooks/useChunkedTranscription';
import { toast } from 'sonner';

interface MicrophoneButtonProps {
  agentId: string;
  userId: string;
  onTranscription: (text: string, options?: { streaming?: boolean; isTranscribing?: boolean }) => void;
  disabled?: boolean;
  /** Optional conversation ID to link audio recordings to */
  conversationId?: string;
}

export function MicrophoneButton({ agentId, userId, onTranscription, disabled, conversationId }: MicrophoneButtonProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const lastTranscriptRef = useRef<string>('');
  
  const { 
    isRecording, 
    isTranscribing,
    transcript, 
    error,
    startRecording, 
    stopRecording,
    clearTranscript,
  } = useChunkedTranscription(agentId, userId);

  // Update parent with streaming transcript and transcribing state
  useEffect(() => {
    if (transcript !== lastTranscriptRef.current || isTranscribing) {
      lastTranscriptRef.current = transcript;
      onTranscription(transcript, { streaming: true, isTranscribing });
    }
  }, [transcript, isTranscribing, onTranscription]);

  // Show error toast
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleClick = async () => {
    if (isRecording || isStopping) {
      // Stop recording
      setIsStopping(true);
      try {
        await stopRecording();
        // Final transcription is already in the input from streaming updates
        if (lastTranscriptRef.current) {
          toast.success('Transcription complete');
        }
      } finally {
        setIsStopping(false);
        lastTranscriptRef.current = '';
      }
    } else {
      // Start recording
      clearTranscript();
      lastTranscriptRef.current = '';
      setIsStarting(true);
      try {
        // Use 3 second chunks for better transcription accuracy
        // Audio is automatically uploaded to Supabase Storage
        await startRecording({
          onTranscriptUpdate: (text: string) => {
            // This callback receives transcript updates
            onTranscription(text, { streaming: true, isTranscribing: false });
          },
          chunkIntervalMs: 3000,
          conversationId,
        });
        toast.info('Listening... speak now (transcribes every 3 seconds)');
      } catch (err) {
        toast.error('Failed to start recording');
        console.error('Recording start error:', err);
      } finally {
        setIsStarting(false);
      }
    }
  };

  // Determine button state
  const isDisabled = disabled || isStarting;
  const showRecording = isRecording || isStopping;
  const showProcessing = isStopping;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      size="default"
      variant={showRecording ? "destructive" : "outline"}
      className="shrink-0"
      title={showRecording ? "Stop recording" : "Start voice input"}
    >
      {showProcessing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
        </>
      ) : showRecording ? (
        <>
          <Square className="h-4 w-4" />
        </>
      ) : (
        <>
          <Mic className="h-4 w-4" />
        </>
      )}
    </Button>
  );
}
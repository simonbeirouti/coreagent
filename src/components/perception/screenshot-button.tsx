import React from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { useVision, ScreenshotResult } from '@/hooks/usePerception';
import { toast } from 'sonner';

interface ScreenshotButtonProps {
  agentId: string;
  conversationId?: string;
  /** 
   * Callback when screenshot is captured
   * @param imageBase64 - Full quality base64 for preview
   * @param storagePath - Path in Supabase storage (for persistence in messages)
   * @param signedUrl - Temporary signed URL for immediate display
   * @param analysis - Optional analysis text
   */
  onScreenshot: (imageBase64: string, storagePath?: string, signedUrl?: string, analysis?: string) => void;
  disabled?: boolean;
}

export function ScreenshotButton({ agentId, conversationId, onScreenshot, disabled }: ScreenshotButtonProps) {
  const { captureScreen, analyzeImage } = useVision(agentId);
  const [lastScreenshot, setLastScreenshot] = React.useState<ScreenshotResult | null>(null);

  const handleCaptureScreenshot = async () => {
    try {
      const result = await captureScreen.mutateAsync({ 
        autoUpload: true,
        conversationId 
      });
      setLastScreenshot(result);
      onScreenshot(result.image_base64, result.storage_path, result.signed_url);
      
      if (result.signed_url) {
        toast.success('Screenshot captured and uploaded');
      } else {
        toast.success('Screenshot captured');
      }
    } catch (error) {
      toast.error('Screenshot failed');
      console.error('Screenshot error:', error);
    }
  };

  const handleAnalyzeScreenshot = async () => {
    if (!lastScreenshot) {
      toast.error('No screenshot to analyze');
      return;
    }

    try {
      const analysis = await analyzeImage.mutateAsync({
        imageBase64: lastScreenshot.image_base64,
        prompt: "Describe what's visible in this screenshot and suggest how I can interact with it."
      });

      onScreenshot(lastScreenshot.image_base64, lastScreenshot.storage_path, lastScreenshot.signed_url, analysis);
      toast.success('Screenshot analyzed');
    } catch (error) {
      toast.error('Analysis failed');
      console.error('Analysis error:', error);
    }
  };

  // Desktop only - hide on mobile
  const isDesktop = typeof window !== 'undefined' && !window.navigator.userAgent.includes('Mobile');

  if (!isDesktop) {
    return null;
  }

  return (
    <div className="flex gap-1">
      <Button
        onClick={handleCaptureScreenshot}
        disabled={disabled || captureScreen.isPending}
        size="default"
        variant="outline"
        className="shrink-0"
        title="Capture screenshot"
      >
        {captureScreen.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </Button>

      {lastScreenshot && (
        <Button
          onClick={handleAnalyzeScreenshot}
          disabled={disabled || analyzeImage.isPending}
          size="default"
          variant="outline"
          className="shrink-0"
          title="Analyze screenshot"
        >
          {analyzeImage.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4 mr-1" />
          )}
          Analyze
        </Button>
      )}
    </div>
  );
}
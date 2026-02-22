import { Button } from '@/components/ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { useVision } from '@/hooks/usePerception';
import { toast } from 'sonner';

interface ScreenshotButtonProps {
  agentId: string;
  conversationId?: string;
  /**
   * Callback when screenshot is captured
   * @param imageBase64 - Full quality base64 for preview
   * @param storagePath - Path in Supabase storage (for persistence in messages)
   * @param signedUrl - Temporary signed URL for immediate display
   */
  onScreenshot: (imageBase64: string, storagePath?: string, signedUrl?: string) => void;
  disabled?: boolean;
}

export function ScreenshotButton({ agentId, conversationId, onScreenshot, disabled }: ScreenshotButtonProps) {
  const { captureScreen } = useVision(agentId);

  const handleCaptureScreenshot = async () => {
    try {
      const result = await captureScreen.mutateAsync({
        autoUpload: true,
        conversationId
      });
      onScreenshot(result.image_base64, result.storage_path, result.signed_url);
    } catch (error) {
      toast.error('Screenshot failed');
      console.error('Screenshot error:', error);
    }
  };

  // Desktop only - hide on mobile
  const isDesktop = typeof window !== 'undefined' && !window.navigator.userAgent.includes('Mobile');

  if (!isDesktop) {
    return null;
  }

  return (
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
  );
}
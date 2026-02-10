import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Paperclip, Loader2 } from 'lucide-react';
import { uploadScreenshot } from '@/lib/storage';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';

interface AttachButtonProps {
  /** 
   * Callback when file is attached and uploaded
   * @param imageBase64 - Full quality base64 for preview
   * @param storagePath - Path in Supabase storage (for persistence in messages)
   * @param signedUrl - Temporary signed URL for immediate display
   */
  onAttach: (imageBase64: string, storagePath?: string, signedUrl?: string) => void;
  disabled?: boolean;
}

export function AttachButton({ onAttach, disabled }: AttachButtonProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (30MB limit to be safe for both OpenAI and Anthropic)
    const maxSizeBytes = 30 * 1024 * 1024; // 30MB
    if (file.size > maxSizeBytes) {
      toast.error('File too large. Maximum size is 30MB.');
      return;
    }

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }

    setIsUploading(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix

          if (!user?.id) {
            toast.error('You must be logged in to attach files');
            return;
          }

          // Determine if compression is needed (JPEG for compression, PNG for lossless)
          const isJpeg = file.type === 'image/jpeg';
          const shouldCompress = file.size > 1024 * 1024; // Compress if > 1MB

          // Upload to Supabase
          const uploadResult = await uploadScreenshot(base64, user.id, {
            isJpeg: shouldCompress && isJpeg,
            contentType: file.type,
          });

          onAttach(base64, `screenshots/${uploadResult.storagePath}`, uploadResult.signedUrl);

          toast.success('File attached successfully');
        } catch (error) {
          console.error('Upload error:', error);
          toast.error('Failed to upload file');
        } finally {
          setIsUploading(false);
        }
      };

      reader.onerror = () => {
        toast.error('Failed to read file');
        setIsUploading(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('File processing error:', error);
      toast.error('Failed to process file');
      setIsUploading(false);
    }

    // Reset input so same file can be selected again
    event.target.value = '';
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <Button
        onClick={handleButtonClick}
        disabled={disabled || isUploading}
        size="default"
        variant="outline"
        className="shrink-0"
        title="Attach image file"
      >
        {isUploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}
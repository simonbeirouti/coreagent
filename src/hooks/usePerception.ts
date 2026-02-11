import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { startRecording as pluginStartRecording, stopRecording as pluginStopRecording } from 'tauri-plugin-mic-recorder-api';
import { uploadScreenshot, compressImage } from '@/lib/storage';
import { useAuth } from '@/hooks/use-auth';
import { abilityKeys, perceptionKeys } from '@/lib/query-keys';
import { dynamic30sQueryPolicy } from '@/lib/query-policies';

export interface ScreenshotResult {
  image_base64: string;
  width: number;
  height: number;
  storage_path: string;
  /** Signed URL for immediate display (may expire) */
  signed_url?: string;
}

export interface RecordingResult {
  audio_base64: string;
  file_path: string;
}

export interface PerceptionStat {
  feature_type: string;
  action: string;
  usage_count: number;
  last_used_at: string;
  metadata: Record<string, any>;
}

export function useVision(agentId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const captureScreen = useMutation({
    mutationFn: async (options?: { 
      autoUpload?: boolean;
      conversationId?: string;
      /** Whether to compress before upload (default: true) */
      compress?: boolean;
      /** JPEG quality 0-1 (default: 0.8) */
      quality?: number;
      /** Max width in pixels (default: 1920) */
      maxWidth?: number;
    }): Promise<ScreenshotResult> => {
      // Capture the screenshot via Rust (full quality PNG)
      const result: ScreenshotResult = await invoke('capture_screenshot', { agentId });
      
      // Auto-upload to Supabase Storage if user is authenticated and option is enabled
      // Default to true for automatic upload
      const shouldUpload = options?.autoUpload !== false && user?.id;
      
      if (shouldUpload && user?.id) {
        try {
          // Compress the image before upload (default: enabled)
          const shouldCompress = options?.compress !== false;
          let imageToUpload = result.image_base64;
          let isJpeg = false;
          
          if (shouldCompress) {
            const quality = options?.quality ?? 0.8;
            const maxWidth = options?.maxWidth ?? 1920;
            
            console.log(`Compressing screenshot (quality: ${quality}, maxWidth: ${maxWidth}px)...`);
            imageToUpload = await compressImage(result.image_base64, quality, maxWidth);
            isJpeg = true;
            
            // Log compression stats
            const originalSize = result.image_base64.length;
            const compressedSize = imageToUpload.length;
            const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);
            console.log(`Compression complete: ${reduction}% size reduction`);
          }
          
          // Upload to Supabase Storage - returns path and signed URL
          const uploadResult = await uploadScreenshot(imageToUpload, user.id, { isJpeg });
          
          // Log the perception with the actual storage path
          await invoke('log_screenshot_perception', {
            agentId,
            storagePath: `screenshots/${uploadResult.storagePath}`,
            conversationId: options?.conversationId || null,
          });
          
          // Return result with storage path and signed URL
          // Note: image_base64 still contains full quality PNG for preview
          return {
            ...result,
            storage_path: `screenshots/${uploadResult.storagePath}`,
            signed_url: uploadResult.signedUrl,
          };
        } catch (uploadError) {
          console.error('Screenshot upload failed:', uploadError);
          // Return result without upload - still usable locally
          return result;
        }
      }
      
      return result;
    },
    onError: (error) => {
      console.error('Screenshot capture failed:', error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: perceptionKeys.stats(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.skillRatings(agentId), refetchType: 'all' });
    },
  });

  const analyzeImage = useMutation({
    mutationFn: async (params: {
      imageBase64: string;
      prompt?: string;
    }): Promise<string> => {
      return invoke('analyze_image', {
        agentId,
        imageBase64: params.imageBase64,
        prompt: params.prompt,
      });
    },
    onError: (error) => {
      console.error('Image analysis failed:', error);
    },
  });

  return { captureScreen, analyzeImage };
}

export function useAudio(agentId: string) {
  const [isRecording, setIsRecording] = React.useState(false);

  const startRecording = useMutation({
    mutationFn: async (): Promise<void> => {
      // Use the mic-recorder plugin to start recording
      await pluginStartRecording();
      // Track usage via our custom command
      await invoke('start_recording', { agentId });
    },
    onSuccess: () => setIsRecording(true),
    onError: (error) => {
      console.error('Start recording failed:', error);
    },
  });

  const stopRecording = useMutation({
    mutationFn: async (): Promise<RecordingResult> => {
      // Use the mic-recorder plugin to stop recording - returns file path
      const filePath = await pluginStopRecording();
      
      // Read the audio file and convert to base64 via Rust backend
      const audioBase64: string = await invoke('read_audio_file', { filePath });
      
      return {
        audio_base64: audioBase64,
        file_path: filePath,
      };
    },
    onSuccess: () => setIsRecording(false),
    onError: (error) => {
      console.error('Stop recording failed:', error);
    },
  });

  const transcribe = useMutation({
    mutationFn: async (audioBase64: string): Promise<string> => {
      return invoke('transcribe_audio', { agentId, audioBase64 });
    },
    onError: (error) => {
      console.error('Audio transcription failed:', error);
    },
  });

  const speak = useMutation({
    mutationFn: async (params: {
      text: string;
      voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    }): Promise<string> => {
      return invoke('text_to_speech', {
        agentId,
        text: params.text,
        voice: params.voice,
      });
    },
    onError: (error) => {
      console.error('Text-to-speech failed:', error);
    },
  });

  return { isRecording, startRecording, stopRecording, transcribe, speak };
}

export function usePerceptionStats(agentId: string) {
  return useQuery({
    queryKey: perceptionKeys.stats(agentId),
    queryFn: async (): Promise<PerceptionStat[]> => {
      return invoke('get_perception_stats', { agentId });
    },
    enabled: !!agentId,
    ...dynamic30sQueryPolicy,
  });
}

// Combined hook for all perception features
export function usePerception(agentId: string) {
  const vision = useVision(agentId);
  const audio = useAudio(agentId);
  const stats = usePerceptionStats(agentId);

  return {
    vision,
    audio,
    stats,
  };
}
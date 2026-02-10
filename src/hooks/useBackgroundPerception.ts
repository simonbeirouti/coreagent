import { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { compressImage } from '@/lib/storage';
import { abilityKeys, perceptionKeys } from '@/lib/query-keys';

export interface ScreenshotResult {
  image_base64: string;
  width: number;
  height: number;
}

export interface BackgroundPerceptionOptions {
  /** Whether background perception is enabled */
  enabled: boolean;
  /** Agent ID for perception tracking */
  agentId: string;
  /** Interval between screenshots in milliseconds (default: 10000 = 10 seconds) */
  intervalMs?: number;
  /** Whether to compress screenshots before sending (default: true) */
  compress?: boolean;
  /** JPEG quality 0-1 when compressing (default: 0.6 for lower bandwidth) */
  quality?: number;
  /** Max width in pixels when compressing (default: 1280 for faster processing) */
  maxWidth?: number;
  /** Callback when a screenshot is captured */
  onScreenshot?: (result: ScreenshotResult) => void;
  /** Callback to send the image to the realtime session */
  sendImage?: (imageBase64: string, prompt?: string) => boolean;
}

interface BackgroundPerceptionState {
  isRunning: boolean;
  screenshotCount: number;
  lastScreenshotAt: Date | null;
  error: string | null;
}

/**
 * Hook for background screen perception during realtime voice chat
 * Captures screenshots at a configurable interval and sends them to the AI session
 */
export function useBackgroundPerception(options: BackgroundPerceptionOptions) {
  const {
    enabled,
    agentId,
    intervalMs = 10000, // Default 10 seconds
    compress = true,
    quality = 0.6, // Lower quality for faster processing
    maxWidth = 1280, // Smaller size for background updates
    onScreenshot,
    sendImage,
  } = options;
  const queryClient = useQueryClient();

  const [state, setState] = useState<BackgroundPerceptionState>({
    isRunning: false,
    screenshotCount: 0,
    lastScreenshotAt: null,
    error: null,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCapturingRef = useRef(false);

  /**
   * Capture a single screenshot
   */
  const captureScreenshot = useCallback(async (): Promise<ScreenshotResult | null> => {
    // Prevent concurrent captures
    if (isCapturingRef.current) {
      return null;
    }

    isCapturingRef.current = true;

    try {
      // Capture screenshot via Tauri
      const result: ScreenshotResult = await invoke('capture_screenshot', { agentId });

      let imageToSend = result.image_base64;

      // Compress if enabled
      if (compress) {
        try {
          imageToSend = await compressImage(result.image_base64, quality, maxWidth);
        } catch (compressError) {
          console.warn('Image compression failed, using original:', compressError);
        }
      }

      // Update state
      setState(prev => ({
        ...prev,
        screenshotCount: prev.screenshotCount + 1,
        lastScreenshotAt: new Date(),
        error: null,
      }));

      // Call onScreenshot callback
      onScreenshot?.({
        ...result,
        image_base64: imageToSend,
      });

      // Send to realtime session if connected
      if (sendImage) {
        const sent = sendImage(imageToSend);
        if (!sent) {
          console.warn('Failed to send screenshot to realtime session');
        }
      }

      // Refresh related cached metrics for dashboard skill ratings.
      queryClient.invalidateQueries({ queryKey: perceptionKeys.stats(agentId) });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: abilityKeys.skillRatings(agentId) });

      return {
        ...result,
        image_base64: imageToSend,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Screenshot capture failed';
      console.error('Background screenshot failed:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
      return null;
    } finally {
      isCapturingRef.current = false;
    }
  }, [agentId, compress, quality, maxWidth, onScreenshot, queryClient, sendImage]);

  /**
   * Start background screenshot capture
   */
  const start = useCallback(() => {
    if (intervalRef.current) {
      console.warn('Background perception already running');
      return;
    }

    console.log(`Starting background perception with ${intervalMs}ms interval`);

    // Capture immediately on start
    captureScreenshot();

    // Set up interval for periodic captures
    intervalRef.current = setInterval(() => {
      captureScreenshot();
    }, intervalMs);

    setState(prev => ({ ...prev, isRunning: true, error: null }));
  }, [intervalMs, captureScreenshot]);

  /**
   * Stop background screenshot capture
   */
  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    console.log('Stopped background perception');
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  /**
   * Capture a single screenshot on demand
   */
  const captureNow = useCallback(async () => {
    return captureScreenshot();
  }, [captureScreenshot]);

  // Auto-start/stop based on enabled prop
  useEffect(() => {
    if (enabled && !state.isRunning) {
      start();
    } else if (!enabled && state.isRunning) {
      stop();
    }
  }, [enabled, state.isRunning, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return {
    isRunning: state.isRunning,
    screenshotCount: state.screenshotCount,
    lastScreenshotAt: state.lastScreenshotAt,
    error: state.error,
    start,
    stop,
    captureNow,
  };
}

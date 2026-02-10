import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AudioCapture, createAudioCapture } from '@/lib/audio-capture';
import { uploadAudio } from '@/lib/storage';

interface ChunkedTranscriptionState {
  isRecording: boolean;
  isTranscribing: boolean;
  transcript: string;
  error: string | null;
}

interface ChunkedTranscriptionOptions {
  /** Callback for transcript updates */
  onTranscriptUpdate?: (text: string) => void;
  /** How often to send chunks in ms (default 3000ms) */
  chunkIntervalMs?: number;
  /** Conversation ID to link audio to (optional) */
  conversationId?: string;
}

/**
 * Estimate audio duration from base64 WAV data
 * Assumes 16kHz, 16-bit mono audio (32000 bytes/sec)
 */
function estimateDurationMs(wavBase64: string): number {
  // Base64 is ~4/3 the size of binary data
  const binarySize = Math.floor(wavBase64.length * 0.75);
  // 16kHz, 16-bit mono = 32000 bytes/sec
  return Math.round((binarySize / 32000) * 1000);
}

/**
 * Hook for chunked audio transcription using Whisper API
 * 
 * Features:
 * - Captures audio from microphone
 * - Sends audio chunks every ~3 seconds to Whisper API for transcription
 * - Accumulates transcription text incrementally
 * - Automatically uploads audio to Supabase Storage
 * - Logs perception data for each chunk
 * 
 * @param agentId - The agent ID for tracking
 * @param userId - The user ID for storage paths (required)
 */
export function useChunkedTranscription(agentId: string, userId: string) {
  const [state, setState] = useState<ChunkedTranscriptionState>({
    isRecording: false,
    isTranscribing: false,
    transcript: '',
    error: null,
  });

  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const transcriptRef = useRef<string>('');
  const isProcessingRef = useRef<boolean>(false);
  const pendingChunksRef = useRef<string[]>([]);
  const onUpdateCallbackRef = useRef<((text: string) => void) | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const savedAudioPathsRef = useRef<string[]>([]);

  /**
   * Process a single audio chunk: upload, transcribe, and log
   */
  const processChunk = useCallback(async (wavBase64: string) => {
    setState(prev => ({ ...prev, isTranscribing: true }));
    
    try {
      console.log('Processing audio chunk...');
      
      // Estimate duration for perception logging
      const durationMs = estimateDurationMs(wavBase64);
      
      // 1. Upload audio to Supabase Storage (frontend has auth context)
      let storagePath: string | undefined;
      try {
        const uploadResult = await uploadAudio(wavBase64, userId);
        storagePath = uploadResult.storagePath;
        savedAudioPathsRef.current.push(storagePath);
        console.log('Audio uploaded to:', storagePath);
      } catch (uploadError) {
        console.error('Audio upload failed:', uploadError);
        // Continue with transcription even if upload fails
      }
      
      // 2. Transcribe via backend
      const transcription: string = await invoke('transcribe_audio', {
        agentId,
        audioBase64: wavBase64,
      });
      
      // 3. Log perception if we have a storage path
      if (storagePath) {
        try {
          await invoke('log_audio_perception', {
            agentId,
            storagePath,
            transcription: transcription || null,
            durationMs,
            conversationId: conversationIdRef.current || null,
          });
          console.log('Perception logged for audio chunk');
        } catch (logError) {
          console.error('Failed to log perception:', logError);
          // Don't fail the whole operation if logging fails
        }
      }

      // Append transcription if we got meaningful text
      if (transcription && transcription.trim()) {
        console.log('Received transcription:', transcription.trim());
        // Add a space between chunks for readability
        if (transcriptRef.current) {
          transcriptRef.current += ' ' + transcription.trim();
        } else {
          transcriptRef.current = transcription.trim();
        }
        
        setState(prev => ({ ...prev, transcript: transcriptRef.current }));
        onUpdateCallbackRef.current?.(transcriptRef.current);
      } else {
        console.log('No transcription text received for this chunk');
      }
    } catch (error) {
      console.error('Chunk processing failed:', error);
      // Don't stop recording on individual chunk failures
    } finally {
      setState(prev => ({ ...prev, isTranscribing: false }));
    }
  }, [agentId, userId]);

  /**
   * Process chunks sequentially to maintain order
   */
  const processNextChunk = useCallback(async () => {
    if (isProcessingRef.current || pendingChunksRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const chunk = pendingChunksRef.current.shift()!;
    
    await processChunk(chunk);
    
    isProcessingRef.current = false;
    
    // Process next chunk if available
    if (pendingChunksRef.current.length > 0) {
      processNextChunk();
    }
  }, [processChunk]);

  /**
   * Handle incoming audio chunk
   */
  const onChunkReady = useCallback((wavBase64: string) => {
    console.log('Audio chunk ready, queuing for processing');
    // Queue the chunk for processing
    pendingChunksRef.current.push(wavBase64);
    processNextChunk();
  }, [processNextChunk]);

  /**
   * Start recording and transcribing
   * Audio is automatically uploaded to Supabase Storage
   * @param options - Configuration options for recording
   */
  const startRecording = useCallback(async (options?: ChunkedTranscriptionOptions) => {
    const {
      onTranscriptUpdate,
      chunkIntervalMs = 3000,
      conversationId,
    } = options || {};

    // Prevent starting if already recording or stopping
    if (audioCaptureRef.current?.capturing || isStoppingRef.current) {
      console.warn('Recording already in progress or stopping');
      return;
    }

    // Reset state
    setState({ isRecording: true, isTranscribing: false, transcript: '', error: null });
    transcriptRef.current = '';
    pendingChunksRef.current = [];
    isProcessingRef.current = false;
    isStoppingRef.current = false;
    savedAudioPathsRef.current = [];
    onUpdateCallbackRef.current = onTranscriptUpdate || null;
    conversationIdRef.current = conversationId;

    try {
      // Create a fresh AudioCapture instance for each recording session
      audioCaptureRef.current = createAudioCapture();
      await audioCaptureRef.current.startBuffered(onChunkReady, chunkIntervalMs);
      console.log('Recording started (with automatic persistence)');
    } catch (error) {
      console.error('Failed to start recording:', error);
      audioCaptureRef.current = null;
      setState(prev => ({
        ...prev,
        isRecording: false,
        error: error instanceof Error ? error.message : 'Failed to start recording',
      }));
    }
  }, [onChunkReady]);

  /**
   * Stop recording and process remaining audio
   */
  const stopRecording = useCallback(async () => {
    // Prevent double-stopping
    if (isStoppingRef.current) {
      console.log('Already stopping recording');
      return;
    }

    if (!audioCaptureRef.current) {
      console.log('No active recording to stop');
      setState(prev => ({ ...prev, isRecording: false }));
      return;
    }

    isStoppingRef.current = true;
    console.log('Stopping recording...');

    try {
      // Stop capture and get remaining audio
      const remainingAudio = audioCaptureRef.current.stop();
      audioCaptureRef.current = null;

      // Process any remaining audio
      if (remainingAudio) {
        console.log('Processing remaining audio...');
        pendingChunksRef.current.push(remainingAudio);
        await processNextChunk();
      }

      // Wait for any pending chunks to finish (with timeout)
      let waitCount = 0;
      const maxWait = 100; // 10 seconds max
      while ((isProcessingRef.current || pendingChunksRef.current.length > 0) && waitCount < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }

      console.log('Recording stopped successfully');
    } catch (error) {
      console.error('Error stopping recording:', error);
    } finally {
      isStoppingRef.current = false;
      setState(prev => ({ ...prev, isRecording: false }));
    }
  }, [processNextChunk]);

  /**
   * Clear the current transcript
   */
  const clearTranscript = useCallback(() => {
    transcriptRef.current = '';
    setState(prev => ({ ...prev, transcript: '', error: null }));
  }, []);

  /**
   * Get the list of saved audio paths from this session
   */
  const getSavedAudioPaths = useCallback(() => {
    return [...savedAudioPathsRef.current];
  }, []);

  return {
    isRecording: state.isRecording,
    isTranscribing: state.isTranscribing,
    transcript: state.transcript,
    error: state.error,
    startRecording,
    stopRecording,
    clearTranscript,
    /** Get list of storage paths for saved audio chunks */
    getSavedAudioPaths,
  };
}

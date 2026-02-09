import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type VoiceChatState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

interface RealtimeVoiceChatState {
  state: VoiceChatState;
  isConnected: boolean;
  error: string | null;
  transcript: TranscriptEntry[];
  currentUserText: string;
  currentAssistantText: string;
  inputAudioLevel: number;
  outputAudioLevel: number;
}

const SAMPLE_RATE = 24000; // OpenAI Realtime API uses 24kHz

interface RealtimeVoiceChatOptions {
  agentInstructions?: string;
  /**
   * Duration of silence (in ms) before the model considers the user done speaking.
   * Higher values give more time between responses, making conversations feel less rushed.
   * Default: 800ms. Range: 200-2000ms recommended.
   */
  silenceDurationMs?: number;
  /**
   * VAD threshold for speech detection. Higher values require louder speech.
   * Default: 0.5. Range: 0.0-1.0.
   */
  vadThreshold?: number;
}

/**
 * Hook for real-time voice chat with OpenAI's Realtime API
 * Supports full-duplex audio conversation with the agent
 */
export function useRealtimeVoiceChat(options: RealtimeVoiceChatOptions = {}) {
  const {
    agentInstructions,
    silenceDurationMs = 800,
    vadThreshold = 0.5,
  } = options;
  const [state, setState] = useState<RealtimeVoiceChatState>({
    state: 'idle',
    isConnected: false,
    error: null,
    transcript: [],
    currentUserText: '',
    currentAssistantText: '',
    inputAudioLevel: 0,
    outputAudioLevel: 0,
  });

  // Refs for WebSocket and audio handling
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);

  /**
   * Convert Float32Array to base64 PCM16
   */
  const floatTo16BitPCMBase64 = useCallback((float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(i * 2, val, true);
    }
    
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  /**
   * Decode base64 PCM16 to Float32Array
   */
  const base64ToFloat32Array = useCallback((base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const view = new DataView(bytes.buffer);
    const float32 = new Float32Array(bytes.length / 2);
    
    for (let i = 0; i < float32.length; i++) {
      const int16 = view.getInt16(i * 2, true);
      float32[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
    }
    
    return float32;
  }, []);

  /**
   * Play audio from queue
   */
  const playNextAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift()!;

    try {
      const audioBuffer = audioContext.createBuffer(1, audioData.byteLength / 2, SAMPLE_RATE);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(audioData);
      
      for (let i = 0; i < channelData.length; i++) {
        const int16 = view.getInt16(i * 2, true);
        channelData[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create analyser for output audio level
      const outputAnalyser = audioContext.createAnalyser();
      outputAnalyser.fftSize = 256;
      source.connect(outputAnalyser);
      outputAnalyser.connect(audioContext.destination);

      // Update output audio level during playback
      const updateOutputLevel = () => {
        const dataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
        outputAnalyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setState(prev => ({ ...prev, outputAudioLevel: average / 255 }));
      };

      const levelInterval = setInterval(updateOutputLevel, 50);

      source.onended = () => {
        clearInterval(levelInterval);
        setState(prev => ({ ...prev, outputAudioLevel: 0 }));
        isPlayingRef.current = false;
        playNextAudio();
      };

      source.start();
    } catch (error) {
      console.error('Error playing audio:', error);
      isPlayingRef.current = false;
      playNextAudio();
    }
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'session.created':
          console.log('Realtime session created');
          setState(prev => ({ ...prev, state: 'listening', isConnected: true }));
          break;

        case 'session.updated':
          console.log('Session updated:', data.session);
          break;

        case 'input_audio_buffer.speech_started':
          console.log('Speech started');
          setState(prev => ({ ...prev, state: 'listening' }));
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('Speech stopped');
          setState(prev => ({ ...prev, state: 'thinking' }));
          break;

        case 'response.created':
          console.log('Response created');
          setState(prev => ({ ...prev, state: 'thinking' }));
          break;

        case 'response.output_audio.delta':
        case 'response.audio.delta': // Also handle old name for compatibility
          // Incoming audio chunk from the model
          if (data.delta) {
            setState(prev => ({ ...prev, state: 'speaking' }));
            const audioData = base64ToFloat32Array(data.delta);
            const buffer = new ArrayBuffer(audioData.length * 2);
            const view = new DataView(buffer);
            for (let i = 0; i < audioData.length; i++) {
              const s = Math.max(-1, Math.min(1, audioData[i]));
              const val = s < 0 ? s * 0x8000 : s * 0x7fff;
              view.setInt16(i * 2, val, true);
            }
            audioQueueRef.current.push(buffer);
            playNextAudio();
          }
          break;

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': // Also handle old name
          // Real-time transcript of what the assistant is saying
          if (data.delta) {
            setState(prev => ({
              ...prev,
              currentAssistantText: prev.currentAssistantText + data.delta,
            }));
          }
          break;

        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done': // Also handle old name
          // Final assistant transcript
          if (data.transcript) {
            setState(prev => ({
              ...prev,
              transcript: [
                ...prev.transcript,
                { role: 'assistant', text: data.transcript, timestamp: new Date() },
              ],
              currentAssistantText: '',
            }));
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User's speech transcription
          if (data.transcript) {
            setState(prev => ({
              ...prev,
              transcript: [
                ...prev.transcript,
                { role: 'user', text: data.transcript, timestamp: new Date() },
              ],
              currentUserText: '',
            }));
          }
          break;

        case 'response.done':
          console.log('Response complete');
          setState(prev => ({ ...prev, state: 'listening' }));
          break;

        case 'error':
          console.error('Realtime API error:', data.error);
          setState(prev => ({
            ...prev,
            error: data.error?.message || 'Unknown error',
            state: 'idle',
          }));
          break;

        default:
          console.log('Realtime event:', data.type);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [base64ToFloat32Array, playNextAudio]);

  /**
   * Update input audio level from microphone
   */
  const updateInputAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    setState(prev => ({ ...prev, inputAudioLevel: average / 255 }));

    animationFrameRef.current = requestAnimationFrame(updateInputAudioLevel);
  }, []);

  /**
   * Start the voice chat session
   */
  const connect = useCallback(async (voice: string = 'alloy') => {
    if (wsRef.current) {
      console.warn('Already connected');
      return;
    }

    setState(prev => ({ ...prev, state: 'connecting', error: null }));

    try {
      // Get ephemeral token from backend
      const token: string = await invoke('get_realtime_session_token', { voice });

      // Create WebSocket connection (GA endpoint with gpt-realtime model)
      const ws = new WebSocket(
        'wss://api.openai.com/v1/realtime?model=gpt-realtime',
        ['realtime', `openai-insecure-api-key.${token}`]
      );

      ws.onopen = async () => {
        console.log('WebSocket connected to OpenAI Realtime API (GA)');

        // Configure session with GA format
        // Using server_vad for configurable turn detection timing
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: 'gpt-realtime',
            instructions: agentInstructions || 'You are a helpful assistant. Be concise and friendly.',
            audio: {
              input: {
                format: {
                  type: 'audio/pcm',
                  rate: SAMPLE_RATE,
                },
                turn_detection: {
                  type: 'server_vad',
                  threshold: vadThreshold,
                  prefix_padding_ms: 300,
                  silence_duration_ms: silenceDurationMs,
                },
                transcription: {
                  model: 'gpt-4o-transcribe',
                },
              },
              output: {
                format: {
                  type: 'audio/pcm',
                  rate: SAMPLE_RATE,
                },
                voice: voice,
              },
            },
          },
        }));

        // Start audio capture
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: SAMPLE_RATE,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });

          mediaStreamRef.current = stream;
          audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
          
          const source = audioContextRef.current.createMediaStreamSource(stream);
          
          // Create analyser for input level visualization
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 256;
          source.connect(analyserRef.current);

          // Create processor for sending audio
          const bufferSize = 4096;
          processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
          
          processorRef.current.onaudioprocess = (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              const inputData = event.inputBuffer.getChannelData(0);
              const base64Audio = floatTo16BitPCMBase64(inputData);
              ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: base64Audio,
              }));
            }
          };

          source.connect(processorRef.current);
          processorRef.current.connect(audioContextRef.current.destination);

          // Start audio level monitoring
          updateInputAudioLevel();
        } catch (audioError) {
          console.error('Failed to access microphone:', audioError);
          setState(prev => ({
            ...prev,
            error: 'Failed to access microphone',
            state: 'idle',
          }));
          ws.close();
        }
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setState(prev => ({
          ...prev,
          error: 'WebSocket connection failed',
          state: 'idle',
          isConnected: false,
        }));
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        cleanup();
        setState(prev => ({
          ...prev,
          state: 'idle',
          isConnected: false,
        }));
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to connect',
        state: 'idle',
      }));
    }
  }, [agentInstructions, silenceDurationMs, vadThreshold, floatTo16BitPCMBase64, handleMessage, updateInputAudioLevel]);

  /**
   * Disconnect from the voice chat session
   */
  const disconnect = useCallback(() => {
    cleanup();
    setState(prev => ({
      ...prev,
      state: 'idle',
      isConnected: false,
    }));
  }, []);

  /**
   * Clean up all resources
   */
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  /**
   * Clear transcript history
   */
  const clearTranscript = useCallback(() => {
    setState(prev => ({
      ...prev,
      transcript: [],
      currentUserText: '',
      currentAssistantText: '',
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state: state.state,
    isConnected: state.isConnected,
    error: state.error,
    transcript: state.transcript,
    currentUserText: state.currentUserText,
    currentAssistantText: state.currentAssistantText,
    inputAudioLevel: state.inputAudioLevel,
    outputAudioLevel: state.outputAudioLevel,
    connect,
    disconnect,
    clearTranscript,
  };
}

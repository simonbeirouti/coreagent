import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { VoiceChatState } from '@/hooks/useRealtimeVoiceChat';

interface AudioVisualizerProps {
  state: VoiceChatState;
  inputAudioLevel: number;
  outputAudioLevel: number;
  className?: string;
}

/**
 * Circular audio visualizer that responds to voice chat state and audio levels
 * 
 * States:
 * - idle: Subtle breathing animation
 * - connecting: Rotating loader animation
 * - listening: Pulsing rings based on user audio amplitude
 * - thinking: Rotating/processing animation
 * - speaking: Waveform distortion based on output audio
 */
export function AudioVisualizer({
  state,
  inputAudioLevel,
  outputAudioLevel,
  className,
}: AudioVisualizerProps) {
  // Calculate dynamic styles based on state and audio levels
  const dynamicStyles = useMemo(() => {
    const baseSize = 200;
    let scale = 1;
    let glowIntensity = 0;
    let ringCount = 3;

    switch (state) {
      case 'listening':
        // Pulse based on input audio level - reduced intensity
        scale = 1 + inputAudioLevel * 0.2;
        glowIntensity = inputAudioLevel * 0.4;
        ringCount = 3;
        break;
      case 'speaking':
        // Pulse based on output audio level
        scale = 1 + outputAudioLevel * 0.2;
        glowIntensity = outputAudioLevel * 0.8;
        ringCount = 5;
        break;
      case 'thinking':
        scale = 1.05;
        glowIntensity = 0.5;
        ringCount = 3;
        break;
      case 'connecting':
        scale = 1;
        glowIntensity = 0.3;
        ringCount = 2;
        break;
      default:
        scale = 1;
        glowIntensity = 0.1;
        ringCount = 2;
    }

    return { baseSize, scale, glowIntensity, ringCount };
  }, [state, inputAudioLevel, outputAudioLevel]);

  // Generate ring elements
  const rings = useMemo(() => {
    return Array.from({ length: dynamicStyles.ringCount }, (_, i) => {
      const delay = i * 0.15;
      const opacity = 1 - (i / dynamicStyles.ringCount) * 0.6;
      const ringScale = 1 + (i * 0.15);
      
      return (
        <div
          key={i}
          className={cn(
            'absolute inset-0 rounded-full border-2 transition-all duration-300',
            state === 'idle' && 'animate-pulse',
            state === 'connecting' && 'animate-spin',
            state === 'thinking' && 'animate-spin',
            state === 'listening' && 'border-primary/40',
            state === 'speaking' && 'border-green-500',
            state === 'connecting' && 'border-yellow-500',
            state === 'thinking' && 'border-blue-500',
            state === 'idle' && 'border-muted-foreground/30',
          )}
          style={{
            transform: `scale(${ringScale * dynamicStyles.scale})`,
            opacity: opacity * (0.3 + dynamicStyles.glowIntensity * 0.7),
            animationDelay: `${delay}s`,
            animationDuration: state === 'thinking' ? '2s' : state === 'connecting' ? '1.5s' : '3s',
          }}
        />
      );
    });
  }, [dynamicStyles, state]);

  // Get state-specific colors and labels
  const stateConfig = useMemo(() => {
    switch (state) {
      case 'connecting':
        return {
          color: 'bg-yellow-500/20',
          borderColor: 'border-yellow-500',
          textColor: 'text-yellow-500',
          label: 'Connecting...',
        };
      case 'listening':
        return {
          color: 'bg-primary/10',
          borderColor: 'border-primary/50',
          textColor: 'text-primary/70',
          label: 'Listening',
        };
      case 'thinking':
        return {
          color: 'bg-blue-500/20',
          borderColor: 'border-blue-500',
          textColor: 'text-blue-500',
          label: 'Thinking...',
        };
      case 'speaking':
        return {
          color: 'bg-green-500/20',
          borderColor: 'border-green-500',
          textColor: 'text-green-500',
          label: 'Speaking',
        };
      default:
        return {
          color: 'bg-muted/20',
          borderColor: 'border-muted-foreground/30',
          textColor: 'text-muted-foreground',
          label: 'Ready',
        };
    }
  }, [state]);

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      {/* Main visualizer container */}
      <div
        className="relative"
        style={{
          width: dynamicStyles.baseSize,
          height: dynamicStyles.baseSize,
        }}
      >
        {/* Outer rings */}
        {rings}

        {/* Main circle */}
        <div
          className={cn(
            'absolute inset-4 rounded-full transition-all duration-150 flex items-center justify-center',
            stateConfig.color,
            stateConfig.borderColor,
            'border-4',
          )}
          style={{
            transform: `scale(${dynamicStyles.scale})`,
            boxShadow: `0 0 ${30 * dynamicStyles.glowIntensity}px ${10 * dynamicStyles.glowIntensity}px currentColor`,
          }}
        >
          {/* Inner content - waveform bars for speaking state */}
          {state === 'speaking' && (
            <div className="flex items-center gap-1 h-12">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="w-2 bg-green-500 rounded-full transition-all duration-75"
                  style={{
                    height: `${20 + outputAudioLevel * 40 * Math.sin((i + Date.now() / 100) * 0.5)}px`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Microphone icon for listening state */}
          {state === 'listening' && (
            <svg
              className={cn('w-12 h-12', stateConfig.textColor)}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}

          {/* Loading spinner for connecting/thinking */}
          {(state === 'connecting' || state === 'thinking') && (
            <svg
              className={cn('w-12 h-12 animate-spin', stateConfig.textColor)}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}

          {/* Idle state icon */}
          {state === 'idle' && (
            <svg
              className={cn('w-12 h-12', stateConfig.textColor)}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
          )}
        </div>
      </div>

      {/* State label */}
      <div className={cn('text-lg font-medium', stateConfig.textColor)}>
        {stateConfig.label}
      </div>
    </div>
  );
}

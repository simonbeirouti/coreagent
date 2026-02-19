/**
 * Audio playback utilities for the Realtime Voice Chat feature
 * Handles decoding and playing audio received from OpenAI Realtime API
 */

const DEFAULT_SAMPLE_RATE = 24000;

/**
 * Decode base64 PCM16 audio to Float32Array
 */
export function decodePCM16Base64(base64: string): Float32Array {
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
}

/**
 * Encode Float32Array to base64 PCM16
 */
export function encodePCM16Base64(float32Array: Float32Array): string {
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
}

/**
 * Audio playback queue manager
 * Handles buffering and sequential playback of audio chunks
 */
export class AudioPlaybackManager {
  private audioContext: AudioContext | null = null;
  private queue: ArrayBuffer[] = [];
  private isPlaying = false;
  private sampleRate: number;
  private onLevelChange?: (level: number) => void;

  constructor(sampleRate: number = DEFAULT_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  /**
   * Initialize the audio context
   */
  async init(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }
    
    // Resume if suspended
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Set callback for audio level changes (for visualization)
   */
  setLevelCallback(callback: (level: number) => void): void {
    this.onLevelChange = callback;
  }

  /**
   * Add audio chunk to the playback queue
   */
  addChunk(base64Audio: string): void {
    const float32 = decodePCM16Base64(base64Audio);
    
    // Convert back to ArrayBuffer for storage
    const buffer = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(i * 2, val, true);
    }
    
    this.queue.push(buffer);
    this.playNext();
  }

  /**
   * Play the next chunk in the queue
   */
  private async playNext(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0 || !this.audioContext) {
      return;
    }

    this.isPlaying = true;
    const audioData = this.queue.shift()!;

    try {
      const audioBuffer = this.audioContext.createBuffer(
        1,
        audioData.byteLength / 2,
        this.sampleRate
      );
      
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(audioData);
      
      for (let i = 0; i < channelData.length; i++) {
        const int16 = view.getInt16(i * 2, true);
        channelData[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create analyser for level monitoring
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(this.audioContext.destination);

      // Monitor audio levels during playback
      let levelInterval: ReturnType<typeof setInterval> | null = null;
      if (this.onLevelChange) {
        levelInterval = setInterval(() => {
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          this.onLevelChange?.(average / 255);
        }, 50);
      }

      source.onended = () => {
        if (levelInterval) {
          clearInterval(levelInterval);
        }
        this.onLevelChange?.(0);
        this.isPlaying = false;
        this.playNext();
      };

      source.start();
    } catch (error) {
      console.error('Error playing audio chunk:', error);
      this.isPlaying = false;
      this.playNext();
    }
  }

  /**
   * Stop playback and clear the queue
   */
  stop(): void {
    this.queue = [];
    this.isPlaying = false;
    this.onLevelChange?.(0);
  }

  /**
   * Close the audio context
   */
  async close(): Promise<void> {
    this.stop();
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Check if currently playing
   */
  get playing(): boolean {
    return this.isPlaying || this.queue.length > 0;
  }
}

/**
 * Calculate average audio level from an AnalyserNode
 */
export function getAudioLevel(analyser: AnalyserNode): number {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);
  const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
  return average / 255;
}

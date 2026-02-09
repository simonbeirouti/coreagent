/**
 * Audio Capture utility for microphone input
 * Captures audio from the microphone and buffers it for chunked transcription
 * Outputs WAV format compatible with OpenAI Whisper API
 */

// Target sample rate for Whisper (16kHz is optimal for speech)
const TARGET_SAMPLE_RATE = 16000;

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isCapturing = false;
  private actualSampleRate: number = TARGET_SAMPLE_RATE;
  
  // Audio buffer for chunking
  private audioBuffer: Float32Array[] = [];
  private onChunkReady: ((wavBase64: string) => void) | null = null;
  private chunkIntervalMs: number = 3000; // Default to 3 seconds for better transcription
  private chunkTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start capturing audio from the microphone with chunked output
   * @param onChunkReady - Callback called with base64-encoded WAV audio every chunkIntervalMs
   * @param chunkIntervalMs - How often to emit audio chunks (default 3000ms - Whisper works better with longer audio)
   */
  async startBuffered(
    onChunkReady: (wavBase64: string) => void,
    chunkIntervalMs: number = 3000
  ): Promise<void> {
    if (this.isCapturing) {
      console.warn('Audio capture already running');
      return;
    }

    this.onChunkReady = onChunkReady;
    this.chunkIntervalMs = chunkIntervalMs;
    this.audioBuffer = [];

    try {
      // Request microphone access - let browser choose optimal settings
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context - use browser's default sample rate for best compatibility
      // We'll resample to 16kHz when creating the WAV file
      this.audioContext = new AudioContext();
      this.actualSampleRate = this.audioContext.sampleRate;
      console.log(`Audio context created with sample rate: ${this.actualSampleRate}Hz`);

      // Create source from microphone stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessorNode for audio processing
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing) return;

        // Copy the audio data to our buffer
        const inputData = event.inputBuffer.getChannelData(0);
        this.audioBuffer.push(new Float32Array(inputData));
      };

      // Connect the audio graph
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isCapturing = true;

      // Start the chunk timer
      this.chunkTimer = setInterval(() => {
        this.emitChunk();
      }, this.chunkIntervalMs);

      console.log(`Audio capture started (buffered mode, ${chunkIntervalMs}ms chunks)`);
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop capturing audio and return any remaining buffered audio
   * @returns Base64-encoded WAV of remaining audio, or null if no audio
   */
  stop(): string | null {
    this.isCapturing = false;
    
    // Clear the chunk timer
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }

    // Get any remaining audio
    const remainingAudio = this.getBufferedWav();
    
    this.cleanup();
    console.log('Audio capture stopped');
    
    return remainingAudio;
  }

  /**
   * Check if currently capturing
   */
  get capturing(): boolean {
    return this.isCapturing;
  }

  /**
   * Emit the current buffer as a WAV chunk
   */
  private emitChunk(): void {
    if (this.audioBuffer.length === 0) return;

    const wavBase64 = this.getBufferedWav();
    if (wavBase64 && this.onChunkReady) {
      this.onChunkReady(wavBase64);
    }
  }

  /**
   * Get buffered audio as WAV base64 and clear the buffer
   */
  private getBufferedWav(): string | null {
    if (this.audioBuffer.length === 0) return null;

    // Merge all chunks into a single Float32Array
    const totalLength = this.audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear the buffer
    this.audioBuffer = [];

    // Resample to 16kHz if needed (Whisper works best at 16kHz)
    let audioData: Float32Array<ArrayBuffer> = merged;
    let sampleRate = this.actualSampleRate;
    
    if (this.actualSampleRate !== TARGET_SAMPLE_RATE) {
      audioData = this.resample(merged, this.actualSampleRate, TARGET_SAMPLE_RATE) as Float32Array<ArrayBuffer>;
      sampleRate = TARGET_SAMPLE_RATE;
      console.log(`Resampled from ${this.actualSampleRate}Hz to ${TARGET_SAMPLE_RATE}Hz`);
    }

    // Convert to WAV
    const wavBuffer = this.createWavFile(audioData, sampleRate);
    return this.arrayBufferToBase64(wavBuffer);
  }

  /**
   * Simple linear interpolation resampling
   */
  private resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    const ratio = fromRate / toRate;
    const newLength = Math.round(samples.length / ratio);
    const result = new Float32Array(newLength);
    
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      
      // Linear interpolation
      result[i] = samples[srcIndexFloor] * (1 - fraction) + samples[srcIndexCeil] * fraction;
    }
    
    return result;
  }

  /**
   * Clean up all audio resources
   */
  private cleanup(): void {
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioBuffer = [];
    this.onChunkReady = null;
  }

  /**
   * Create a WAV file from Float32Array audio samples
   */
  private createWavFile(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    this.writeString(view, 8, 'WAVE');

    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write audio samples as 16-bit PCM
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, val, true);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Write a string to a DataView
   */
  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

/**
 * Create a new AudioCapture instance
 * Each recording session should use a fresh instance to avoid state issues
 */
export function createAudioCapture(): AudioCapture {
  return new AudioCapture();
}

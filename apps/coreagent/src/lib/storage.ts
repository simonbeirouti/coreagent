import supabase from './supabase';

/**
 * Decode base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compress an image using Canvas API
 * Converts to JPEG with specified quality and optional max dimensions
 * 
 * @param base64 - Base64 encoded image data (without data URL prefix)
 * @param quality - JPEG quality (0-1), default 0.8
 * @param maxWidth - Maximum width in pixels, default 1920
 * @returns Compressed base64 string (without data URL prefix)
 */
export async function compressImage(
  base64: string, 
  quality = 0.8, 
  maxWidth = 1920
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      
      // Scale down if wider than maxWidth
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Draw image onto canvas (this also handles the resize)
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to JPEG with quality setting
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      
      // Extract base64 without the data URL prefix
      const compressedBase64 = dataUrl.split(',')[1];
      
      if (!compressedBase64) {
        reject(new Error('Failed to compress image'));
        return;
      }
      
      resolve(compressedBase64);
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image for compression'));
    };
    
    // Load the image from base64
    img.src = `data:image/png;base64,${base64}`;
  });
}

export interface UploadScreenshotOptions {
  /** Whether the image is JPEG format (default: false, assumes PNG) */
  isJpeg?: boolean;
}

export interface ScreenshotUploadResult {
  /** Storage path for the file (e.g., "userId/timestamp.jpg") */
  storagePath: string;
  /** Temporary signed URL for immediate display */
  signedUrl: string;
}

/**
 * Upload a screenshot to Supabase Storage
 * @param base64 - Base64 encoded image data (without data URL prefix)
 * @param userId - User ID to organize uploads
 * @param options - Upload options
 * @returns Storage path and signed URL for immediate display
 */
export async function uploadScreenshot(
  base64: string, 
  userId: string,
  options?: UploadScreenshotOptions
): Promise<ScreenshotUploadResult> {
  const isJpeg = options?.isJpeg ?? false;
  const extension = isJpeg ? 'jpg' : 'png';
  const contentType = isJpeg ? 'image/jpeg' : 'image/png';
  
  const fileName = `${userId}/${Date.now()}.${extension}`;
  const bytes = base64ToBytes(base64);
  
  const { error } = await supabase.storage
    .from('screenshots')
    .upload(fileName, bytes, { 
      contentType,
      upsert: false 
    });
  
  if (error) {
    console.error('Screenshot upload failed:', error);
    throw new Error(`Failed to upload screenshot: ${error.message}`);
  }
  
  // Generate a signed URL for immediate display (1 hour expiry)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('screenshots')
    .createSignedUrl(fileName, 3600);
  
  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedUrlError?.message || 'Unknown error'}`);
  }
  
  return {
    storagePath: fileName,
    signedUrl: signedUrlData.signedUrl,
  };
}

/**
 * Get a signed URL for a screenshot
 * @param storagePath - Storage path (e.g., "userId/timestamp.jpg")
 * @param expiresIn - Expiration time in seconds (default 1 hour)
 * @returns Signed URL for temporary access
 */
export async function getScreenshotSignedUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('screenshots')
    .createSignedUrl(storagePath, expiresIn);
  
  if (error) {
    console.error('Failed to create screenshot signed URL:', error);
    return null;
  }
  
  return data?.signedUrl || null;
}

/**
 * Audio upload result containing path and optional signed URL
 */
export interface AudioUploadResult {
  storagePath: string;
  signedUrl?: string;
}

/**
 * Upload audio to Supabase Storage
 * @param base64 - Base64 encoded audio data (WAV format)
 * @param userId - User ID to organize uploads
 * @param filename - Optional custom filename (defaults to timestamp)
 * @returns Storage path and optional signed URL
 */
export async function uploadAudio(
  base64: string, 
  userId: string,
  filename?: string
): Promise<AudioUploadResult> {
  const fileName = filename || `${Date.now()}.wav`;
  const storagePath = `${userId}/${fileName}`;
  const bytes = base64ToBytes(base64);
  
  const { error } = await supabase.storage
    .from('audio')
    .upload(storagePath, bytes, { 
      contentType: 'audio/wav',
      upsert: false 
    });
  
  if (error) {
    console.error('Audio upload failed:', error);
    throw new Error(`Failed to upload audio: ${error.message}`);
  }
  
  // Create a signed URL for temporary access (valid for 1 hour)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('audio')
    .createSignedUrl(storagePath, 3600);
  
  return {
    storagePath: `audio/${storagePath}`,
    signedUrl: signedUrlError ? undefined : signedUrlData?.signedUrl,
  };
}

/**
 * Get a signed URL for an audio file
 * @param storagePath - Full storage path (e.g., "audio/userId/filename.wav")
 * @param expiresIn - Expiration time in seconds (default 1 hour)
 * @returns Signed URL for temporary access
 */
export async function getAudioSignedUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  // Remove bucket prefix if present
  const path = storagePath.replace(/^audio\//, '');
  
  const { data, error } = await supabase.storage
    .from('audio')
    .createSignedUrl(path, expiresIn);
  
  if (error) {
    console.error('Failed to create signed URL:', error);
    return null;
  }
  
  return data?.signedUrl || null;
}

/**
 * Delete an audio file from Supabase Storage
 * @param storagePath - Full storage path (e.g., "audio/userId/filename.wav")
 */
export async function deleteAudio(storagePath: string): Promise<void> {
  // Remove bucket prefix if present
  const path = storagePath.replace(/^audio\//, '');
  
  const { error } = await supabase.storage
    .from('audio')
    .remove([path]);
  
  if (error) {
    console.error('Audio deletion failed:', error);
    throw new Error(`Failed to delete audio: ${error.message}`);
  }
}

/**
 * Delete a screenshot from Supabase Storage
 * @param url - Public URL of the screenshot to delete
 */
export async function deleteScreenshot(url: string): Promise<void> {
  // Extract the path from the URL
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/storage/v1/object/public/screenshots/');
  if (pathParts.length < 2) {
    throw new Error('Invalid screenshot URL');
  }
  
  const filePath = decodeURIComponent(pathParts[1]);
  
  const { error } = await supabase.storage
    .from('screenshots')
    .remove([filePath]);
  
  if (error) {
    console.error('Screenshot deletion failed:', error);
    throw new Error(`Failed to delete screenshot: ${error.message}`);
  }
}

import supabase from './supabase';

export const ALLOWED_USER_FILE_EXTENSIONS = [
  'txt',
  'pdf',
  'doc',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
] as const;
export type AllowedUserFileExtension = (typeof ALLOWED_USER_FILE_EXTENSIONS)[number];

export interface UserFileRecord {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  file_ext: AllowedUserFileExtension;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface UserFileUploadResult {
  record: UserFileRecord;
  signedUrl: string;
}

const USER_ASSETS_BUCKET = 'user-files';
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MIN_IMAGE_COMPRESSION_QUALITY = 0.35;
const MIN_IMAGE_COMPRESSION_WIDTH = 640;

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

export function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.replace(/\s/g, '');
  if (!trimmed) {
    return 0;
  }
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

function assertByteLimit(sizeBytes: number, maxBytes: number, label: string): void {
  if (sizeBytes > maxBytes) {
    throw new Error(`${label} exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit (${sizeBytes} bytes).`);
  }
}

function getFileExtension(name: string): string {
  const segments = name.toLowerCase().split('.');
  return segments.length > 1 ? segments[segments.length - 1] : '';
}

function assertAllowedUserFile(file: File): AllowedUserFileExtension {
  const extension = getFileExtension(file.name);
  if (!ALLOWED_USER_FILE_EXTENSIONS.includes(extension as AllowedUserFileExtension)) {
    throw new Error(
      `Unsupported file type '${extension || 'unknown'}'. Allowed types: ${ALLOWED_USER_FILE_EXTENSIONS.join(', ')}.`
    );
  }
  return extension as AllowedUserFileExtension;
}

async function insertUserFileMetadata(input: {
  userId: string;
  storagePath: string;
  fileName: string;
  fileExt: AllowedUserFileExtension;
  mimeType: string;
  sizeBytes: number;
}): Promise<UserFileRecord> {
  const { data, error } = await supabase
    .from('user_files')
    .insert({
      user_id: input.userId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      file_ext: input.fileExt,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    })
    .select('*')
    .single<UserFileRecord>();

  if (error || !data) {
    throw new Error(`Failed to persist file metadata: ${error?.message || 'Unknown error'}`);
  }

  return data;
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

export async function compressImageToFitLimit(
  base64: string,
  maxBytes: number,
  options?: { quality?: number; maxWidth?: number }
): Promise<{ base64: string; quality: number; maxWidth: number; sizeBytes: number }> {
  let quality = options?.quality ?? 0.8;
  let maxWidth = options?.maxWidth ?? 1920;
  let current = await compressImage(base64, quality, maxWidth);
  let currentSize = estimateBase64Bytes(current);

  if (currentSize <= maxBytes) {
    return {
      base64: current,
      quality,
      maxWidth,
      sizeBytes: currentSize,
    };
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    quality = Math.max(MIN_IMAGE_COMPRESSION_QUALITY, quality - 0.1);
    maxWidth = Math.max(MIN_IMAGE_COMPRESSION_WIDTH, Math.floor(maxWidth * 0.85));
    current = await compressImage(base64, quality, maxWidth);
    currentSize = estimateBase64Bytes(current);
    if (currentSize <= maxBytes) {
      return {
        base64: current,
        quality,
        maxWidth,
        sizeBytes: currentSize,
      };
    }
  }

  throw new Error(
    `Image exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit after compression (${currentSize} bytes).`
  );
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
  if (!userId) {
    throw new Error('You must be logged in to upload screenshots.');
  }
  const isJpeg = options?.isJpeg ?? false;
  const extension = isJpeg ? 'jpg' : 'png';
  const contentType = isJpeg ? 'image/jpeg' : 'image/png';

  const fileName = `${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bytes = base64ToBytes(base64);
  assertByteLimit(bytes.byteLength, MAX_ATTACHMENT_BYTES, 'Screenshot');

  const { error } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
    .upload(fileName, bytes, { 
      contentType,
      upsert: false 
    });
  
  if (error) {
    console.error('Screenshot upload failed:', error);
    throw new Error(`Failed to upload screenshot: ${error.message}`);
  }

  try {
    await insertUserFileMetadata({
      userId,
      storagePath: fileName,
      fileName: `screenshot-${Date.now()}.${extension}`,
      fileExt: extension as AllowedUserFileExtension,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
    });
  } catch (insertError) {
    await supabase.storage.from(USER_ASSETS_BUCKET).remove([fileName]);
    throw insertError instanceof Error ? insertError : new Error('Failed to persist screenshot metadata');
  }

  // Generate a signed URL for immediate display (1 hour expiry)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
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
  const path = storagePath.replace(/^screenshots\//, '').replace(/^user-files\//, '');
  const { data, error } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
    .createSignedUrl(path, expiresIn);
  
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
  assertByteLimit(bytes.byteLength, MAX_ATTACHMENT_BYTES, 'Audio file');
  
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
  const pathParts = urlObj.pathname.split('/storage/v1/object/public/user-files/');
  if (pathParts.length < 2) {
    throw new Error('Invalid screenshot URL');
  }
  
  const filePath = decodeURIComponent(pathParts[1]);

  const { error } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
    .remove([filePath]);
  
  if (error) {
    console.error('Screenshot deletion failed:', error);
    throw new Error(`Failed to delete screenshot: ${error.message}`);
  }
}

export async function uploadUserFile(file: File, userId: string): Promise<UserFileUploadResult> {
  if (!userId) {
    throw new Error('You must be logged in to upload files.');
  }

  const fileExt = assertAllowedUserFile(file);
  assertByteLimit(file.size, MAX_ATTACHMENT_BYTES, 'File');
  const safeFileName = file.name.replace(/\s+/g, '_');
  const storagePath = `${userId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  let inserted: UserFileRecord;
  try {
    inserted = await insertUserFileMetadata({
      userId,
      storagePath,
      fileName: file.name,
      fileExt,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
  } catch (insertError) {
    await supabase.storage.from(USER_ASSETS_BUCKET).remove([storagePath]);
    throw insertError;
  }

  const signedUrl = await getUserFileSignedUrl(storagePath, 3600);
  if (!signedUrl) {
    throw new Error('File uploaded but signed URL could not be generated.');
  }

  return {
    record: inserted,
    signedUrl,
  };
}

export async function getUserFileSignedUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  const path = storagePath.replace(/^user-files\//, '');
  const { data, error } = await supabase.storage
    .from(USER_ASSETS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error('Failed to create user file signed URL:', error);
    return null;
  }
  return data?.signedUrl || null;
}

export async function deleteUserFile(record: Pick<UserFileRecord, 'id' | 'storage_path'>): Promise<void> {
  const { error: dbError } = await supabase.from('user_files').delete().eq('id', record.id);
  if (dbError) {
    throw new Error(`Failed to delete file metadata: ${dbError.message}`);
  }

  const path = record.storage_path.replace(/^user-files\//, '');
  const { error: storageError } = await supabase.storage.from(USER_ASSETS_BUCKET).remove([path]);
  if (storageError) {
    throw new Error(`File metadata deleted, but storage cleanup failed: ${storageError.message}`);
  }
}

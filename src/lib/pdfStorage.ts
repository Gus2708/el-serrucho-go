import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const BUCKET = 'change-orders';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Sanitizes a storage file name to prevent path traversal and restrict to safe characters.
 */
export function sanitizeStorageFileName(rawName: string): string {
  if (!rawName) return 'document.pdf';

  // Replace backslashes and slashes with underscores to neutralize path traversal
  let safe = rawName.replace(/\\|\//g, '_');

  // Strip path traversal sequences like '..'
  safe = safe.replace(/\.{2,}/g, '.');

  // Strip leading dots or underscores
  safe = safe.replace(/^[._]+/, '');

  // Restrict to letters, digits, dots, dashes, and underscores
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '_');

  // If the result is empty or just an extension like '.pdf', return fallback
  if (!safe || safe === '.pdf' || safe === '.') {
    return 'document.pdf';
  }

  return safe;
}

/**
 * Uploads a PDF blob to Supabase Storage and returns the signed URL.
 * Throws if the upload fails or no signed URL is returned.
 */
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string> {
  const safeFileName = sanitizeStorageFileName(fileName);
  let fileData: Blob | ArrayBuffer;

  if (Platform.OS === 'web') {
    fileData = await fetch(localUri).then(r => r.blob());
  } else {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    fileData = decode(base64);
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(safeFileName, fileData, { contentType: 'application/pdf' });

  if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(safeFileName, SIGNED_URL_SECONDS);

  const url = signedData?.signedUrl;
  if (!url) throw new Error('PDF uploaded but signed URL was not returned');
  return url;
}


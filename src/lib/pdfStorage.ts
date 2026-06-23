import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const BUCKET = 'change-orders';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Uploads a PDF blob to Supabase Storage and returns the signed URL.
 * Throws if the upload fails or no signed URL is returned.
 */
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string> {
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
    .upload(fileName, fileData, { contentType: 'application/pdf' });

  if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileName, SIGNED_URL_SECONDS);

  const url = signedData?.signedUrl;
  if (!url) throw new Error('PDF uploaded but signed URL was not returned');
  return url;
}


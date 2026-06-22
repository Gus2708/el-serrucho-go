import { supabase } from './supabase';

const BUCKET = 'change-orders';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Uploads a PDF blob to Supabase Storage and returns the signed URL.
 * Returns null if the upload fails — callers decide how to handle failure.
 */
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string | null> {
  const fileData = await fetch(localUri).then(r => r.blob());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, fileData, { contentType: 'application/pdf' });

  if (uploadError) return null;

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileName, SIGNED_URL_SECONDS);

  return signedData?.signedUrl ?? null;
}

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
  const fileData = await fetch(localUri).then(r => r.blob());

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

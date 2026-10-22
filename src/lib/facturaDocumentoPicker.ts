import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { MAX_DOCUMENT_BYTES, bytesToHex } from './facturaDocumento';
import { reportFacturaThrown } from './facturaTelemetry';

/** Device-only adapters (system picker, file reads, hashing). Rules and limits live in facturaDocumento. */

export type PickResult =
  | { ok: true; bytes: Uint8Array; nombre: string }
  | { ok: false; error: string };

async function readWebBlob(asset: DocumentPicker.DocumentPickerAsset): Promise<Blob> {
  if (asset.file) return asset.file;
  const response = await fetch(asset.uri);
  return response.blob();
}

async function readAssetBytes(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const blob = await readWebBlob(asset);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  return new Uint8Array(decode(base64));
}

/** Opens the system picker for one PDF or image. Returns null when the user cancels. */
export async function pickFacturaDocument(): Promise<PickResult | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
      base64: false,
    });
    if (result.canceled) return null;

    const asset = result.assets[0];
    if (asset.size !== undefined && asset.size > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: 'El archivo supera el límite de 10 MB' };
    }
    return { ok: true, bytes: await readAssetBytes(asset), nombre: asset.name };
  } catch (error) {
    reportFacturaThrown('pick_document', error);
    throw error;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return bytesToHex(digest);
}

export function newUuid(): string {
  return Crypto.randomUUID();
}

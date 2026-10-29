import type { RequestAsset } from '../generated/RequestAsset';
import { uploadDecisionAsset } from '../api/decisions';

export interface DraftAttachment {
  reference: string;
  file: File;
  previewUrl: string;
  uploadedAssetId?: string;
}

const INLINE_ASSET_LIMIT = 256 * 1024;

export function createDraftAttachments(files: FileList | readonly File[]): DraftAttachment[] {
  return Array.from(files).map(file => ({
    reference: newAssetReference(),
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

export function revokeDraftAttachments(attachments: readonly DraftAttachment[]): void {
  for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
}

export function newAssetReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `asset_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function withAssetReferences<T>(value: T, references: readonly string[]): T | Record<string, unknown> {
  if (references.length === 0) return value;
  const base = value && typeof value === 'object' && !Array.isArray(value) && !('_systorch' in value)
    ? { ...(value as Record<string, unknown>) }
    : value === undefined || value === null || value === ''
      ? {}
      : { text: value };
  return { ...base, _systorch: { assets: [...references] } };
}

export function assetReferences(value: unknown, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (known.has(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
  return [...found];
}

function mediaType(file: File): string {
  const major = file.type.split('/', 1)[0]?.toLowerCase();
  return major === 'image' || major === 'audio' || major === 'video' ? major : 'file';
}

function mediaFormat(file: File): string | undefined {
  const subtype = file.type.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (subtype) return subtype === 'jpeg' ? 'jpg' : subtype;
  const extension = file.name.split('.').pop()?.trim().toLowerCase();
  return extension && extension !== file.name.toLowerCase() ? extension : undefined;
}

async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}

export async function buildAssetDescriptors(
  attachments: readonly DraftAttachment[],
  signal?: AbortSignal,
  uploadAsset = uploadDecisionAsset,
  inlineLimit = INLINE_ASSET_LIMIT,
): Promise<Record<string, RequestAsset>> {
  const result: Record<string, RequestAsset> = {};
  for (const attachment of attachments) {
    const { file, reference } = attachment;
    const descriptor: RequestAsset = {
      type: mediaType(file),
      ...(mediaFormat(file) ? { format: mediaFormat(file) } : {}),
      mime_type: file.type || 'application/octet-stream',
      filename: file.name,
    };
    if (file.size <= inlineLimit) {
      descriptor.data_base64 = await base64(file);
    } else {
      if (!attachment.uploadedAssetId) {
        const receipt = await uploadAsset(file, signal);
        attachment.uploadedAssetId = receipt.asset_id;
        descriptor.mime_type = receipt.mime_type;
      }
      descriptor.asset_id = attachment.uploadedAssetId;
    }
    result[reference] = descriptor;
  }
  return result;
}

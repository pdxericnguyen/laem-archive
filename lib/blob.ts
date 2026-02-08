/**
 * Vercel Blob integration placeholder.
 *
 * Intended flow:
 * 1) Server route creates signed upload URL/token.
 * 2) Client uploads directly to Blob.
 * 3) Blob returns public URL.
 * 4) URL is stored in KV product images[].
 */
export type BlobUploadResult = { url: string };

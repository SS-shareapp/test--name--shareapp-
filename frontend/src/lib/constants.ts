export const MAX_FILE_BYTES = 1_073_741_824;
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
export const SHARE_CODE_LENGTH = 10;
export const PRESIGN_EXPIRES_SECONDS = 60 * 30;

export function computeExpiresAt(sizeBytes: number): string {
  const ttlSeconds = Math.ceil((sizeBytes * 8) / 50_000_000 + 3600);
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

import type { ChunkSize } from './chunk-size';
import type { ChunkIndex } from './chunk-index';
import type { FileSize } from './file-size';
import type { Sha256Hash } from './sha256-hash';
import { deriveFingerprint, type FileFingerprint } from './fingerprint';

/**
 * total_chunks = ceil(file_size / chunk_size). Debe COINCIDIR con la validación
 * anti-DoS del backend en `/initiate` (US-01 AC-1).
 */
export function computeTotalChunks(fileSize: FileSize, chunkSize: ChunkSize): number {
  return Math.ceil(fileSize.bytes / chunkSize.bytes);
}

/**
 * Plan de subida determinista, calculado *client-side* antes de `/initiate`
 * (Value Object inmutable, sin identidad — decisión D005).
 */
export class UploadPlan {
  private constructor(
    readonly fileName: string,
    readonly fileSize: FileSize,
    readonly chunkSize: ChunkSize,
    readonly totalChunks: number,
    readonly totalHash: Sha256Hash,
    readonly fingerprint: FileFingerprint,
  ) {}

  static create(input: {
    fileName: string;
    fileSize: FileSize;
    chunkSize: ChunkSize;
    totalHash: Sha256Hash;
  }): UploadPlan {
    const totalChunks = computeTotalChunks(input.fileSize, input.chunkSize);
    const fingerprint = deriveFingerprint(input.fileName, input.fileSize, input.totalHash);
    return new UploadPlan(
      input.fileName,
      input.fileSize,
      input.chunkSize,
      totalChunks,
      input.totalHash,
      fingerprint,
    );
  }

  /** Rango de bytes [start, end) del chunk. El último puede ser menor que chunkSize. */
  boundariesOf(index: ChunkIndex): { start: number; end: number } {
    if (index.value >= this.totalChunks) {
      throw new RangeError(
        `chunk_index ${index.value} fuera de rango (totalChunks=${this.totalChunks})`,
      );
    }
    const start = index.value * this.chunkSize.bytes;
    const end = Math.min(start + this.chunkSize.bytes, this.fileSize.bytes);
    return { start, end };
  }
}

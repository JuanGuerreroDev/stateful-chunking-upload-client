import { describe, it, expect } from 'vitest';
import { UploadPlan, computeTotalChunks } from '../../src/domain/upload-plan';
import { ChunkSize } from '../../src/domain/chunk-size';
import { FileSize } from '../../src/domain/file-size';
import { ChunkIndex } from '../../src/domain/chunk-index';
import { Sha256Hash } from '../../src/domain/sha256-hash';

const HASH = 'a'.repeat(64);

describe('computeTotalChunks (US-01 AC-1)', () => {
  it('= ceil(file_size / chunk_size)', () => {
    expect(computeTotalChunks(FileSize.of(2097152), ChunkSize.of())).toBe(1);
    expect(computeTotalChunks(FileSize.of(2097153), ChunkSize.of())).toBe(2);
    expect(computeTotalChunks(FileSize.of(2097152 * 3), ChunkSize.of())).toBe(3);
  });

  it('AC-6: un archivo de un solo chunk da total_chunks = 1', () => {
    expect(computeTotalChunks(FileSize.of(1), ChunkSize.of())).toBe(1);
  });
});

describe('UploadPlan', () => {
  const plan = UploadPlan.create({
    fileName: 'video.mp4',
    fileSize: FileSize.of(2097152 * 2 + 100),
    chunkSize: ChunkSize.of(),
    totalHash: Sha256Hash.of(HASH),
  });

  it('calcula total_chunks y fingerprint al crear', () => {
    expect(plan.totalChunks).toBe(3);
    expect(plan.fingerprint.value).toContain('video.mp4');
  });

  it('boundariesOf: el último chunk es más pequeño', () => {
    expect(plan.boundariesOf(ChunkIndex.of(0))).toEqual({ start: 0, end: 2097152 });
    expect(plan.boundariesOf(ChunkIndex.of(2))).toEqual({
      start: 2097152 * 2,
      end: 2097152 * 2 + 100,
    });
  });

  it('boundariesOf: índice fuera de rango lanza', () => {
    expect(() => plan.boundariesOf(ChunkIndex.of(3))).toThrow(RangeError);
  });
});

import { describe, it, expect } from 'vitest';
import { UploadSession, type RemoteSnapshot } from '../../src/domain/upload-session';
import { UploadPlan } from '../../src/domain/upload-plan';
import { ChunkSize } from '../../src/domain/chunk-size';
import { FileSize } from '../../src/domain/file-size';
import { Sha256Hash } from '../../src/domain/sha256-hash';

const HASH = 'c'.repeat(64);

function makeSession(): UploadSession {
  const plan = UploadPlan.create({
    fileName: 'f.bin',
    fileSize: FileSize.of(2097152 * 3),
    chunkSize: ChunkSize.of(),
    totalHash: Sha256Hash.of(HASH),
  });
  return new UploadSession('sess-1', plan);
}

function snapshot(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    status: 'uploading',
    pending_chunks: [1, 2],
    uploaded_bytes: 2097152,
    is_expired: false,
    remaining_ttl: 21600,
    ...overrides,
  };
}

describe('UploadSession (D008 — fidelidad de contrato)', () => {
  it('nace en remoteStatus="pending"', () => {
    expect(makeSession().remoteStatus).toBe('pending');
  });

  it('applyRemote sincroniza status/pending/ttl desde el backend', () => {
    const s = makeSession();
    s.applyRemote(snapshot());
    expect(s.remoteStatus).toBe('uploading');
    expect([...s.pendingChunks]).toEqual([1, 2]);
    expect(s.uploadedBytes).toBe(2097152);
    expect(s.remainingTtlSeconds).toBe(21600);
  });

  it('allChunksUploaded es true solo cuando no hay pendientes', () => {
    const s = makeSession();
    s.applyRemote(snapshot({ pending_chunks: [] }));
    expect(s.allChunksUploaded()).toBe(true);
  });

  it('is_expired en la respuesta marca expiredDetected sin tocar remoteStatus', () => {
    const s = makeSession();
    s.applyRemote(snapshot({ is_expired: true }));
    expect(s.expiredDetected).toBe(true);
    expect(s.remoteStatus).toBe('uploading');
    expect(s.isResumable()).toBe(false);
  });

  it('isResumable: true en pending/uploading no expirada; false en terminales', () => {
    const s = makeSession();
    s.applyRemote(snapshot({ status: 'uploading' }));
    expect(s.isResumable()).toBe(true);
    s.applyRemote(snapshot({ status: 'completed' }));
    expect(s.isResumable()).toBe(false);
    s.applyRemote(snapshot({ status: 'cancelled' }));
    expect(s.isResumable()).toBe(false);
  });
});

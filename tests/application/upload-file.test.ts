import { describe, it, expect, vi } from 'vitest';
import { uploadFile } from '../../src/application/upload-file';
import type { ByteSource } from '../../src/ports/byte-source';
import type { Hasher } from '../../src/ports/hasher';
import type { Transport } from '../../src/ports/transport';
import type { DomainEvent } from '../../src/domain/events';
import { IntegrityError } from '../../src/errors';
import { jsonResponse } from '../fixtures/load';

const CHUNK = 262144; // 256 KB
const FILE_SIZE = CHUNK * 2 + 50; // 3 chunks: 2 completos + 1 parcial
const TOTAL_HASH = 'a'.repeat(64);
const CHUNK_HASH = 'b'.repeat(64);

/** Fuente de bytes en memoria (devuelve ceros del tamaño pedido). */
const source: ByteSource = {
  size: () => FILE_SIZE,
  slice: async (start, end) => new Uint8Array(end - start),
};

/** Hasher determinista (no ejercitamos crypto real aquí). */
const hasher: Hasher = { sha256: async () => CHUNK_HASH };

function sessionBody(pending: number[], uploaded: number, status = 'uploading') {
  return {
    message: 'ok',
    data: {
      session_id: 'sess-1',
      status,
      pending_chunks: pending,
      uploaded_bytes: uploaded,
      is_expired: false,
      remaining_ttl: 3600,
    },
  };
}

/**
 * Transport secuencial que simula el backend: initiate → 3 uploads → complete.
 * `completeBody` permite inyectar respuestas de `/complete` (para fail-closed).
 */
function backendTransport(completeBody: unknown): {
  transport: Transport;
  uploadFields: FormData[];
} {
  const uploadFields: FormData[] = [];
  const uploadedAfter = [CHUNK, CHUNK * 2, FILE_SIZE];
  const pendingAfter = [[1, 2], [2], []];
  const transport: Transport = async (url, init) => {
    const u = url.toString();
    if (u.endsWith('/initiate')) {
      return jsonResponse(201, sessionBody([0, 1, 2], 0, 'pending'));
    }
    if (u.endsWith('/upload')) {
      const form = init?.body as FormData;
      uploadFields.push(form);
      const index = Number(form.get('chunk_index'));
      return jsonResponse(200, sessionBody(pendingAfter[index]!, uploadedAfter[index]!));
    }
    if (u.endsWith('/complete')) {
      return jsonResponse(200, completeBody);
    }
    throw new Error(`endpoint inesperado: ${u}`);
  };
  return { transport, uploadFields };
}

const okComplete = {
  message: 'File reassembled successfully',
  data: {
    session_id: 'sess-1',
    upload_token: 'tok-123',
    file_name: 'video.mp4',
    file_size: FILE_SIZE,
    computed_hash: TOTAL_HASH,
    verified: true,
  },
};

describe('uploadFile — happy path (US-01/02/06)', () => {
  it('sube 3 chunks en orden, reporta progreso y emite eventos, y devuelve CompletionResult', async () => {
    const { transport, uploadFields } = backendTransport(okComplete);
    const events: DomainEvent[] = [];
    const report = vi.fn();

    const result = await uploadFile({
      baseUrl: 'https://api.example.com/api/chunks',
      source,
      hasher,
      transport,
      fileName: 'video.mp4',
      totalHash: TOTAL_HASH,
      chunkSize: CHUNK,
      onProgress: { report },
      onEvent: (e) => events.push(e),
    });

    // Resultado.
    expect(result.uploadToken).toBe('tok-123');
    expect(result.verified).toBe(true);

    // 3 chunks subidos, en orden, con su hash.
    expect(uploadFields.map((f) => f.get('chunk_index'))).toEqual(['0', '1', '2']);
    expect(uploadFields.every((f) => f.get('chunk_hash') === CHUNK_HASH)).toBe(true);

    // Progreso: 3 reportes, el último con uploaded == fileSize.
    expect(report).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith(FILE_SIZE, FILE_SIZE);

    // Eventos: 3 ChunkUploaded + 1 UploadCompleted.
    expect(events.filter((e) => e.type === 'ChunkUploaded')).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: 'UploadCompleted', verified: true });
  });
});

describe('uploadFile — integridad fail-closed (SEC-02, D011.2)', () => {
  it('lanza IntegrityError y emite UploadFailed si computed_hash no coincide', async () => {
    const mismatch = { ...okComplete, data: { ...okComplete.data, computed_hash: 'c'.repeat(64) } };
    const { transport } = backendTransport(mismatch);
    const events: DomainEvent[] = [];

    await expect(
      uploadFile({
        baseUrl: 'https://api.example.com/api/chunks',
        source,
        hasher,
        transport,
        fileName: 'video.mp4',
        totalHash: TOTAL_HASH,
        chunkSize: CHUNK,
        onEvent: (e) => events.push(e),
      }),
    ).rejects.toBeInstanceOf(IntegrityError);

    expect(events.at(-1)?.type).toBe('UploadFailed');
  });

  it('lanza IntegrityError si verified=false aunque el hash coincida', async () => {
    const notVerified = { ...okComplete, data: { ...okComplete.data, verified: false } };
    const { transport } = backendTransport(notVerified);

    await expect(
      uploadFile({
        baseUrl: 'https://api.example.com/api/chunks',
        source,
        hasher,
        transport,
        fileName: 'video.mp4',
        totalHash: TOTAL_HASH,
        chunkSize: CHUNK,
      }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });
});

describe('uploadFile — validaciones fail-fast', () => {
  it('rechaza un file_name mal formado antes de tocar la red', async () => {
    const transport = vi.fn<Transport>();
    await expect(
      uploadFile({
        baseUrl: 'https://api.example.com/api/chunks',
        source,
        hasher,
        transport,
        fileName: 'bad name.mp4',
        totalHash: TOTAL_HASH,
        chunkSize: CHUNK,
      }),
    ).rejects.toThrow(/file_name/);
    expect(transport).not.toHaveBeenCalled();
  });
});

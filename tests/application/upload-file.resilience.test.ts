import { describe, it, expect, vi } from 'vitest';
import { uploadFile } from '../../src/application/upload-file';
import type { ByteSource } from '../../src/ports/byte-source';
import type { Hasher } from '../../src/ports/hasher';
import type { Transport } from '../../src/ports/transport';
import type { DomainEvent } from '../../src/domain/events';
import type { RetryPolicy } from '../../src/domain/retry';
import {
  CancelledError,
  InsecureTransportError,
  RetryExhaustedError,
} from '../../src/errors';
import { jsonResponse } from '../fixtures/load';

const BASE = 'https://api.example.com/api/chunks';
const CHUNK = 262144;
const TOTAL_HASH = 'a'.repeat(64);
const CHUNK_HASH = 'b'.repeat(64);
const FAST: RetryPolicy = { maxRetries: 2, baseDelayMs: 1, factor: 2, maxDelayMs: 4, jitter: 'none' };

const source: ByteSource = { size: () => 100, slice: async (s, e) => new Uint8Array(e - s) };
const hasher: Hasher = { sha256: async () => CHUNK_HASH };

function sessionBody(
  pending: number[],
  uploaded: number,
  opts: { status?: string; isExpired?: boolean } = {},
) {
  return {
    message: 'ok',
    data: {
      session_id: 'sess-1',
      status: opts.status ?? 'uploading',
      pending_chunks: pending,
      uploaded_bytes: uploaded,
      is_expired: opts.isExpired ?? false,
      remaining_ttl: opts.isExpired ? 0 : 3600,
    },
  };
}

function completeBody(hash = TOTAL_HASH, verified = true) {
  return {
    message: 'ok',
    data: {
      session_id: 'sess-1',
      upload_token: 'tok-123',
      file_name: 'f.bin',
      file_size: 100,
      computed_hash: hash,
      verified,
    },
  };
}

const base = {
  baseUrl: BASE,
  source,
  hasher,
  fileName: 'f.bin',
  totalHash: TOTAL_HASH,
  chunkSize: CHUNK,
  retryPolicy: FAST,
  concurrency: 1,
};

describe('uploadFile — reintentos (US-07)', () => {
  it('reintenta un chunk que falla 5xx y luego completa; emite ChunkFailed', async () => {
    let uploadAttempts = 0;
    const transport: Transport = async (url) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) return jsonResponse(201, sessionBody([0], 0, { status: 'pending' }));
      if (u.endsWith('/upload')) {
        uploadAttempts++;
        if (uploadAttempts === 1) return jsonResponse(500, { message: 'storage falló' });
        return jsonResponse(200, sessionBody([], 100));
      }
      if (u.endsWith('/complete')) return jsonResponse(200, completeBody());
      throw new Error(`inesperado: ${u}`);
    };
    const events: DomainEvent[] = [];

    const result = await uploadFile({ ...base, transport, onEvent: (e) => events.push(e) });

    expect(result.verified).toBe(true);
    expect(uploadAttempts).toBe(2);
    const failed = events.find((e) => e.type === 'ChunkFailed');
    expect(failed).toMatchObject({ type: 'ChunkFailed', index: 0, attempt: 0, willRetry: true });
  });

  it('agota los reintentos → RetryExhaustedError con el chunk_index (US-07 AC-4)', async () => {
    const transport: Transport = async (url) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) return jsonResponse(201, sessionBody([0], 0, { status: 'pending' }));
      if (u.endsWith('/upload')) return jsonResponse(500, { message: 'siempre falla' });
      throw new Error(`inesperado: ${u}`);
    };

    const error = await uploadFile({ ...base, transport }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect((error as RetryExhaustedError).chunkIndex).toBe(0);
  });
});

describe('uploadFile — cancelación (US-04)', () => {
  it('aborta en vuelo, llama a /cancel y rechaza con CancelledError', async () => {
    const controller = new AbortController();
    let cancelCalled = false;
    const transport: Transport = async (url) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) return jsonResponse(201, sessionBody([0], 0, { status: 'pending' }));
      if (u.endsWith('/upload')) {
        controller.abort();
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (u.includes('/cancel/')) {
        cancelCalled = true;
        return jsonResponse(200, { message: 'Session cancelled and resources purged' });
      }
      throw new Error(`inesperado: ${u}`);
    };

    const error = await uploadFile({ ...base, transport, signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CancelledError);
    expect(cancelCalled).toBe(true);
  });
});

describe('uploadFile — expiración → nueva sesión (US-08)', () => {
  it('reinicia con una sesión nueva cuando initiate reporta is_expired', async () => {
    let initiateCalls = 0;
    const transport: Transport = async (url) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) {
        initiateCalls++;
        if (initiateCalls === 1) return jsonResponse(201, sessionBody([0], 0, { isExpired: true }));
        return jsonResponse(201, sessionBody([0], 0, { status: 'pending' }));
      }
      if (u.endsWith('/upload')) return jsonResponse(200, sessionBody([], 100));
      if (u.endsWith('/complete')) return jsonResponse(200, completeBody());
      throw new Error(`inesperado: ${u}`);
    };

    const result = await uploadFile({ ...base, transport });
    expect(result.verified).toBe(true);
    expect(initiateCalls).toBe(2);
  });

  it('un 404 a mitad de subida emite SessionExpired y reinicia una vez', async () => {
    let initiateCalls = 0;
    let uploadCalls = 0;
    const transport: Transport = async (url) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) {
        initiateCalls++;
        return jsonResponse(201, sessionBody([0], 0, { status: 'pending' }));
      }
      if (u.endsWith('/upload')) {
        uploadCalls++;
        if (uploadCalls === 1) return jsonResponse(404, { message: 'Upload session not found.' });
        return jsonResponse(200, sessionBody([], 100));
      }
      if (u.endsWith('/complete')) return jsonResponse(200, completeBody());
      throw new Error(`inesperado: ${u}`);
    };
    const events: DomainEvent[] = [];

    const result = await uploadFile({ ...base, transport, onEvent: (e) => events.push(e) });
    expect(result.verified).toBe(true);
    expect(initiateCalls).toBe(2);
    expect(events.some((e) => e.type === 'SessionExpired')).toBe(true);
  });
});

describe('uploadFile — reanudación (US-03)', () => {
  it('sube solo los chunks pendientes y emite SessionResumed', async () => {
    const uploaded: string[] = [];
    const transport: Transport = async (url, init) => {
      const u = url.toString();
      if (u.endsWith('/initiate')) return jsonResponse(201, sessionBody([2], CHUNK * 2)); // uploading, parcial
      if (u.endsWith('/upload')) {
        uploaded.push(String((init?.body as FormData).get('chunk_index')));
        return jsonResponse(200, sessionBody([], CHUNK * 2 + 50));
      }
      if (u.endsWith('/complete')) return jsonResponse(200, completeBody());
      throw new Error(`inesperado: ${u}`);
    };
    const events: DomainEvent[] = [];
    // 3 chunks lógicos (source de 3 chunks) pero solo el índice 2 pendiente.
    const threeChunkSource: ByteSource = { size: () => CHUNK * 2 + 50, slice: async (s, e) => new Uint8Array(e - s) };

    const result = await uploadFile({
      ...base,
      source: threeChunkSource,
      transport,
      onEvent: (e) => events.push(e),
    });

    expect(result.verified).toBe(true);
    expect(uploaded).toEqual(['2']); // solo el pendiente
    expect(events.find((e) => e.type === 'SessionResumed')).toMatchObject({ pending: 1 });
  });
});

describe('uploadFile — enforcement de HTTPS (SEC-01/D013)', () => {
  it('rechaza un baseUrl http no-local antes de tocar la red', async () => {
    const transport = vi.fn<Transport>();
    await expect(
      uploadFile({ ...base, baseUrl: 'http://evil.example.com/api/chunks', transport }),
    ).rejects.toBeInstanceOf(InsecureTransportError);
    expect(transport).not.toHaveBeenCalled();
  });
});

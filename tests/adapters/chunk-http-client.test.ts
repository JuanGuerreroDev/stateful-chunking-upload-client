import { describe, it, expect } from 'vitest';
import { ChunkHttpClient } from '../../src/adapters/http/chunk-http-client';
import type { Transport } from '../../src/ports/transport';
import {
  IntegrityError,
  SessionExpiredError,
  UploadHttpError,
} from '../../src/errors';
import { fixtureResponse, jsonResponse, loadErrorScenarios } from '../fixtures/load';

interface Recorded {
  url: string;
  init?: RequestInit;
}

/** Transport que registra la última petición y devuelve una respuesta fija. */
function recordingTransport(response: Response): { transport: Transport; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url: url.toString(), init });
    return response;
  };
  return { transport, calls };
}

const BASE = 'https://api.example.com/api/chunks';

describe('ChunkHttpClient — /initiate (contract)', () => {
  it('parsea el snapshot y extrae session_id; envía JSON al endpoint correcto', async () => {
    const { transport, calls } = recordingTransport(fixtureResponse('initiate.json'));
    const client = new ChunkHttpClient(BASE, transport);

    const result = await client.initiate({
      fileName: 'video.mp4',
      fileSize: 5242880,
      totalChunks: 3,
      totalHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      fingerprint: 'video.mp4:5242880:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });

    expect(result.sessionId).toBe('9f8c1e2a-4b3d-4c5e-8a7f-1234567890ab');
    expect(result.snapshot.status).toBe('pending');
    expect(result.snapshot.pending_chunks).toEqual([0, 1, 2]);
    expect(result.snapshot.uploaded_bytes).toBe(0);

    expect(calls[0]!.url).toBe(`${BASE}/initiate`);
    expect(calls[0]!.init?.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body).toMatchObject({ file_name: 'video.mp4', total_chunks: 3 });
  });

  it('normaliza una baseUrl con barra final', async () => {
    const { transport, calls } = recordingTransport(fixtureResponse('initiate.json'));
    const client = new ChunkHttpClient(`${BASE}/`, transport);
    await client.initiate({
      fileName: 'video.mp4',
      fileSize: 5242880,
      totalChunks: 3,
      totalHash: 'a'.repeat(64),
      fingerprint: 'x',
    });
    expect(calls[0]!.url).toBe(`${BASE}/initiate`);
  });
});

describe('ChunkHttpClient — /upload (contract, multipart)', () => {
  it('envía multipart/form-data con los campos del chunk y parsea el snapshot', async () => {
    const { transport, calls } = recordingTransport(fixtureResponse('upload.json'));
    const client = new ChunkHttpClient(BASE, transport);

    const snapshot = await client.uploadChunk({
      sessionId: '9f8c1e2a-4b3d-4c5e-8a7f-1234567890ab',
      chunkIndex: 0,
      chunkHash: 'b'.repeat(64),
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(snapshot.status).toBe('uploading');
    expect(snapshot.pending_chunks).toEqual([1, 2]);
    expect(snapshot.uploaded_bytes).toBe(2097152);

    expect(calls[0]!.url).toBe(`${BASE}/upload`);
    const form = calls[0]!.init?.body;
    expect(form).toBeInstanceOf(FormData);
    const fd = form as FormData;
    expect(fd.get('session_id')).toBe('9f8c1e2a-4b3d-4c5e-8a7f-1234567890ab');
    expect(fd.get('chunk_index')).toBe('0');
    expect(fd.get('chunk_hash')).toBe('b'.repeat(64));
    expect(fd.get('file')).toBeInstanceOf(Blob);
    // No fijamos content-type manualmente: fetch añade el boundary del multipart.
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.has('content-type')).toBe(false);
  });
});

describe('ChunkHttpClient — /complete (contract)', () => {
  it('mapea fileReassembled a CompletionResult', async () => {
    const { transport } = recordingTransport(fixtureResponse('complete.json'));
    const client = new ChunkHttpClient(BASE, transport);

    const result = await client.complete('9f8c1e2a-4b3d-4c5e-8a7f-1234567890ab');

    expect(result.uploadToken).toBe(
      'eyJpdiI6ImFiYzEyMyIsInZhbHVlIjoiZGVmNDU2Iiwic2lnIjoiZ2hpNzg5In0=',
    );
    expect(result.verified).toBe(true);
    expect(result.computedHash).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
    expect(result.fileSize).toBe(5242880);
  });
});

describe('ChunkHttpClient — mapeo de errores (ADR-B2-07)', () => {
  const scenarios = loadErrorScenarios();

  it('404 → SessionExpiredError', async () => {
    const { transport } = recordingTransport(
      jsonResponse(scenarios.session_not_found.status, scenarios.session_not_found.body),
    );
    const client = new ChunkHttpClient(BASE, transport);
    await expect(client.complete('x')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('422 (integridad) → IntegrityError', async () => {
    const { transport } = recordingTransport(
      jsonResponse(scenarios.chunk_integrity.status, scenarios.chunk_integrity.body),
    );
    const client = new ChunkHttpClient(BASE, transport);
    await expect(
      client.uploadChunk({ sessionId: 'x', chunkIndex: 0, chunkHash: 'a', bytes: new Uint8Array(1) }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });

  it('500 (transitorio) → UploadHttpError con status 500', async () => {
    const { transport } = recordingTransport(
      jsonResponse(scenarios.storage_failure.status, scenarios.storage_failure.body),
    );
    const client = new ChunkHttpClient(BASE, transport);
    const error = await client.complete('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadHttpError);
    expect((error as UploadHttpError).status).toBe(500);
  });

  it('403 → UploadHttpError con status 403', async () => {
    const { transport } = recordingTransport(
      jsonResponse(scenarios.unauthorized.status, scenarios.unauthorized.body),
    );
    const client = new ChunkHttpClient(BASE, transport);
    const error = await client.complete('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadHttpError);
    expect((error as UploadHttpError).status).toBe(403);
  });

  it('429 (throttle) → UploadHttpError con status 429', async () => {
    // El middleware throttle del backend está activo por defecto y emite 429.
    const { transport } = recordingTransport(jsonResponse(429, { message: 'Too Many Requests' }));
    const client = new ChunkHttpClient(BASE, transport);
    const error = await client
      .uploadChunk({ sessionId: 'x', chunkIndex: 0, chunkHash: 'a', bytes: new Uint8Array(1) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadHttpError);
    expect((error as UploadHttpError).status).toBe(429);
  });
});

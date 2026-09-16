import { describe, it, expect } from 'vitest';
import { ChunkHttpClient } from '../../src/adapters/http/chunk-http-client';
import type { Transport } from '../../src/ports/transport';
import { InsecureTransportError, SessionExpiredError, UploadHttpError } from '../../src/errors';
import { fixtureResponse, jsonResponse } from '../fixtures/load';

const BASE = 'https://api.example.com/api/chunks';
const SID = '9f8c1e2a-4b3d-4c5e-8a7f-1234567890ab';

interface Call {
  url: string;
  method: string;
}

function capturing(response: (url: string) => Response): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = async (url, init) => {
    const u = url.toString();
    calls.push({ url: u, method: init?.method ?? 'GET' });
    return response(u);
  };
  return { transport, calls };
}

describe('ChunkHttpClient.status — GET /status/{sessionId} (US-03/08)', () => {
  it('consulta la ruta con path param y parsea el snapshot', async () => {
    const { transport, calls } = capturing(() => fixtureResponse('status.uploading.json'));
    const client = new ChunkHttpClient(BASE, transport);

    const snapshot = await client.status(SID);

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE}/status/${SID}`);
    expect(snapshot.pending_chunks).toEqual([2]);
    expect(snapshot.is_expired).toBe(false);
  });

  it('mapea 404 a SessionExpiredError', async () => {
    const { transport } = capturing(() => jsonResponse(404, { message: 'Upload session not found.' }));
    const client = new ChunkHttpClient(BASE, transport);
    await expect(client.status(SID)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe('ChunkHttpClient.cancel — DELETE /cancel/{sessionId} (US-04)', () => {
  it('invoca la ruta de cancelación con path param', async () => {
    const { transport, calls } = capturing(() => fixtureResponse('cancel.json'));
    const client = new ChunkHttpClient(BASE, transport);

    await expect(client.cancel(SID)).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toBe(`${BASE}/cancel/${SID}`);
  });

  it('es best-effort: no lanza ante una respuesta no-OK', async () => {
    const { transport } = capturing(() => jsonResponse(500, { message: 'boom' }));
    const client = new ChunkHttpClient(BASE, transport);
    await expect(client.cancel(SID)).resolves.toBeUndefined();
  });
});

describe('ChunkHttpClient — Retry-After en 429 (US-07 AC-5)', () => {
  it('acarrea Retry-After (segundos) en UploadHttpError.retryAfterMs', async () => {
    const transport: Transport = async () =>
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      });
    const client = new ChunkHttpClient(BASE, transport);

    const error = await client
      .uploadChunk({ sessionId: SID, chunkIndex: 0, chunkHash: 'a'.repeat(64), bytes: new Uint8Array(1) })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadHttpError);
    expect((error as UploadHttpError).status).toBe(429);
    expect((error as UploadHttpError).retryAfterMs).toBe(2000);
  });
});

describe('ChunkHttpClient — enforcement de HTTPS en el constructor (SEC-01)', () => {
  it('rechaza un baseUrl inseguro al construir', () => {
    const transport: Transport = async () => new Response('{}');
    expect(() => new ChunkHttpClient('http://evil.example.com/api/chunks', transport)).toThrow(
      InsecureTransportError,
    );
  });
});

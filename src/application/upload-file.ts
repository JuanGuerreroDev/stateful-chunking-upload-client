import type { ByteSource } from '../ports/byte-source';
import type { Hasher } from '../ports/hasher';
import type { Transport } from '../ports/transport';
import type { DomainEvent, ProgressReporter } from '../domain/events';
import { ChunkSize } from '../domain/chunk-size';
import { FileSize } from '../domain/file-size';
import { ChunkIndex } from '../domain/chunk-index';
import { Sha256Hash } from '../domain/sha256-hash';
import { UploadPlan } from '../domain/upload-plan';
import { UploadSession } from '../domain/upload-session';
import { assertSecureBaseUrl } from '../domain/secure-url';
import { classifyError, DEFAULT_RETRY_POLICY, type RetryPolicy } from '../domain/retry';
import {
  CancelledError,
  IntegrityError,
  RetryExhaustedError,
  SessionExpiredError,
  SessionNotResumableError,
} from '../errors';
import { ChunkHttpClient, type CompletionResult } from '../adapters/http/chunk-http-client';
import { resolveTransport } from '../adapters/http/default-transport';
import { validateFileName } from './validate-file-name';
import { withRetry, isAbortError, throwIfAborted, toFailureContext } from './with-retry';
import { concurrencyPool } from './concurrency-pool';

/** Concurrencia por defecto (RES-03, D014.2). */
const DEFAULT_CONCURRENCY = 3;

/** Dependencias de `uploadFile` (contrato de `logical_design.md` §5). */
export interface UploadFileDeps {
  /** URL base del backend, incluido su prefijo (p. ej. `https://api.example.com/api/chunks`). */
  baseUrl: string | URL;
  /** Fuente de bytes troceable (BlobByteSource en web, NodeByteSource en Node). */
  source: ByteSource;
  /** Hasher SHA-256 (típicamente `new WebCryptoHasher()`). */
  hasher: Hasher;
  /** Nombre del archivo (validado estructuralmente, decisión 1A). */
  fileName: string;
  /** Hash SHA-256 esperado del archivo completo, en hex (lo aporta el consumidor, ADR-B2-01). */
  totalHash: string;
  /** Transporte fetch-compatible; si se omite, usa `globalThis.fetch` (auth fuera del SDK). */
  transport?: Transport;
  /** Tamaño de chunk en bytes; default 2 MiB. Debe coincidir con el backend (D3). */
  chunkSize?: number;
  /** Progreso agregado tras cada chunk confirmado (US-01 AC-4). */
  onProgress?: ProgressReporter;
  /** Observador de eventos de dominio internos (D006). */
  onEvent?: (event: DomainEvent) => void;
  /** Señal de cancelación cooperativa (US-04). */
  signal?: AbortSignal;
  /** Chunks en paralelo; default 3 (RES-03). Entero ≥ 1. */
  concurrency?: number;
  /** Política de reintentos; default `DEFAULT_RETRY_POLICY` (US-07). */
  retryPolicy?: RetryPolicy;
}

/** Señal interna: la sesión no es reanudable/expiró → reiniciar con una nueva (D014.4). */
class RestartSession {}

/**
 * Sube un archivo por chunks de extremo a extremo con resiliencia (US-01/02/03/04/07/08).
 *
 * Compone las costuras de B3 sobre el flujo de B2: enforcement de HTTPS en el borde
 * (SEC-01), concurrencia acotada (pool de workers), reintentos por chunk (`withRetry`
 * sobre la política pura de B1), cancelación cooperativa (`AbortSignal` + `/cancel`
 * fail-safe) y reinicio de sesión **una sola vez** ante expiración/no-reanudable.
 * Integridad *fail-closed* de B2 intacta (por chunk + re-verificación al completar).
 */
export async function uploadFile(deps: UploadFileDeps): Promise<CompletionResult> {
  // 1. Enforcement de transporte seguro (SEC-01) y validaciones fail-fast en cliente.
  assertSecureBaseUrl(deps.baseUrl);
  validateFileName(deps.fileName);
  const fileSize = FileSize.of(deps.source.size());
  const chunkSize = ChunkSize.of(deps.chunkSize ?? ChunkSize.DEFAULT);
  const totalHash = Sha256Hash.of(deps.totalHash);
  const plan = UploadPlan.create({ fileName: deps.fileName, fileSize, chunkSize, totalHash });

  const transport = resolveTransport(deps.transport);
  const client = new ChunkHttpClient(deps.baseUrl, transport); // re-valida el esquema (defensa en profundidad).
  const policy = deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;

  // 2. Ejecuta la sesión; si no es reanudable/expiró, reinicia con una nueva UNA vez (D014.4).
  try {
    return await runSession(false);
  } catch (error) {
    if (error instanceof RestartSession) {
      return await runSession(true);
    }
    throw error;
  }

  async function runSession(fresh: boolean): Promise<CompletionResult> {
    let sessionId: string | undefined;
    try {
      throwIfAborted(deps.signal);

      // 2a. Iniciar la sesión: su snapshot es la fuente autoritativa de pendientes (ADR-B3-05).
      const initiated = await client.initiate(
        {
          fileName: deps.fileName,
          fileSize: fileSize.bytes,
          totalChunks: plan.totalChunks,
          totalHash: totalHash.hex,
          fingerprint: plan.fingerprint.value,
        },
        deps.signal,
      );
      sessionId = initiated.sessionId;
      const session = new UploadSession(initiated.sessionId, plan);
      session.applyRemote(initiated.snapshot);

      // 2b. Reanudabilidad: sesión completada/cancelada/expirada → nueva sesión (una vez).
      if (session.expiredDetected || !session.isResumable()) {
        if (!fresh) throw new RestartSession();
        throw new SessionNotResumableError(
          'La sesión iniciada no es reanudable tras reiniciar con una nueva; abortando.',
        );
      }
      if (!fresh && session.pendingChunks.size < plan.totalChunks) {
        deps.onEvent?.({
          type: 'SessionResumed',
          sessionId: session.sessionId,
          pending: session.pendingChunks.size,
        });
      }

      // 2c. Subir los chunks pendientes con concurrencia acotada + reintentos por chunk.
      const indices = [...session.pendingChunks].sort((a, b) => a - b);
      await concurrencyPool(
        indices,
        concurrency,
        (index, signal) => uploadOneChunk(session, index, signal),
        deps.signal,
      );

      // 2d. Completar y re-verificar la integridad total (fail-closed, B2).
      const result = await client.complete(session.sessionId, deps.signal);
      if (!result.verified || result.computedHash !== totalHash.hex) {
        throw new IntegrityError(
          'La verificación de integridad del archivo completo falló al completar (computed_hash no coincide con total_hash).',
        );
      }
      deps.onEvent?.({ type: 'UploadCompleted', verified: result.verified });
      return result;
    } catch (error) {
      if (error instanceof RestartSession) throw error; // burbujea al reinicio de sesión.

      // Cancelación: purga best-effort y mapea a CancelledError (US-04).
      if (isAbortError(error) || deps.signal?.aborted) {
        if (sessionId) await safeCancel(sessionId);
        throw new CancelledError('Subida cancelada por el consumidor.', error);
      }

      // Expiración a mitad de vuelo: reiniciar sesión una vez (US-08 AC-3/4).
      if (error instanceof SessionExpiredError) {
        if (sessionId) deps.onEvent?.({ type: 'SessionExpired', sessionId });
        if (!fresh) throw new RestartSession();
        deps.onEvent?.({ type: 'UploadFailed', cause: error });
        throw error;
      }

      deps.onEvent?.({ type: 'UploadFailed', cause: error });
      throw error;
    }
  }

  async function uploadOneChunk(
    session: UploadSession,
    index: number,
    signal: AbortSignal,
  ): Promise<void> {
    const { start, end } = plan.boundariesOf(ChunkIndex.of(index));
    try {
      await withRetry(
        async () => {
          throwIfAborted(signal);
          // Re-lee y re-hashea en cada intento: idempotente por chunk_index (US-07 AC-2).
          const bytes = await deps.source.slice(start, end);
          const chunkHash = await deps.hasher.sha256(bytes);
          const snapshot = await client.uploadChunk(
            { sessionId: session.sessionId, chunkIndex: index, chunkHash, bytes },
            signal,
          );
          session.applyRemote(snapshot);
          deps.onProgress?.report(session.uploadedBytes, fileSize.bytes);
          deps.onEvent?.({ type: 'ChunkUploaded', index });
        },
        {
          policy,
          signal,
          onAttemptFailed: ({ attempt, error, willRetry }) =>
            deps.onEvent?.({ type: 'ChunkFailed', index, attempt, willRetry, cause: error }),
        },
      );
    } catch (error) {
      throw wrapChunkError(error, index);
    }
  }

  async function safeCancel(id: string): Promise<void> {
    try {
      await client.cancel(id);
    } catch {
      // Fail-safe (US-04 AC-4): un fallo de /cancel nunca enmascara el CancelledError.
    }
  }
}

/**
 * Clasifica el error que escapó de `withRetry`: si era **transitorio**, llegó aquí por
 * reintentos agotados → `RetryExhaustedError(index, …)` (US-07 AC-4). Si era **permanente**
 * (integridad, 413, 403…) o un aborto/expiración con semántica propia, propaga el tipo
 * original intacto para no perder su significado.
 */
function wrapChunkError(error: unknown, index: number): unknown {
  if (isAbortError(error)) return error; // aborto → CancelledError arriba.
  if (error instanceof SessionExpiredError) return error; // → capa de sesión.
  const { failure } = toFailureContext(error);
  if (classifyError(failure) === 'transient') {
    const message = error instanceof Error ? error.message : String(error);
    return new RetryExhaustedError(
      index,
      `El chunk ${index} agotó los reintentos: ${message}`,
      error,
    );
  }
  return error; // permanente: propaga el error tipado original (con su status/semántica).
}

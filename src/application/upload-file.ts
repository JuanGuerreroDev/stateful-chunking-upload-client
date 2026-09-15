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
import { IntegrityError } from '../errors';
import { ChunkHttpClient, type CompletionResult } from '../adapters/http/chunk-http-client';
import { resolveTransport } from '../adapters/http/default-transport';
import { validateFileName } from './validate-file-name';

/** Dependencias de `uploadFile` (contrato de `logical_design.md` §7). */
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
}

/**
 * Sube un archivo por chunks de extremo a extremo (US-01/02/06, D011).
 *
 * Orquesta `initiate → upload* → complete` de forma **secuencial** (la
 * concurrencia y los reintentos llegan en B3). Integridad *fail-closed* en dos
 * planos: hash por chunk (validado por el backend) y re-verificación en cliente
 * del `computed_hash` al completar — no se confía ciegamente en `verified`
 * (SEC-02). Depende solo de puertos, por lo que es testeable con dobles.
 */
export async function uploadFile(deps: UploadFileDeps): Promise<CompletionResult> {
  // 1. Validaciones fail-fast en cliente (sin round-trip).
  validateFileName(deps.fileName);
  const fileSize = FileSize.of(deps.source.size());
  const chunkSize = ChunkSize.of(deps.chunkSize ?? ChunkSize.DEFAULT);
  const totalHash = Sha256Hash.of(deps.totalHash);
  const plan = UploadPlan.create({ fileName: deps.fileName, fileSize, chunkSize, totalHash });

  const transport = resolveTransport(deps.transport);
  const client = new ChunkHttpClient(deps.baseUrl, transport);

  try {
    // 2. Iniciar la sesión.
    const { sessionId, snapshot } = await client.initiate({
      fileName: deps.fileName,
      fileSize: fileSize.bytes,
      totalChunks: plan.totalChunks,
      totalHash: totalHash.hex,
      fingerprint: plan.fingerprint.value,
    });
    const session = new UploadSession(sessionId, plan);
    session.applyRemote(snapshot);

    // 3. Subir los chunks pendientes en orden (secuencial).
    for (let index = 0; index < plan.totalChunks; index++) {
      if (!session.pendingChunks.has(index)) {
        continue; // ya subido (reanudación natural; se explota plenamente en B3).
      }
      const { start, end } = plan.boundariesOf(ChunkIndex.of(index));
      const bytes = await deps.source.slice(start, end);
      const chunkHash = await deps.hasher.sha256(bytes);
      const chunkSnapshot = await client.uploadChunk({
        sessionId,
        chunkIndex: index,
        chunkHash,
        bytes,
      });
      session.applyRemote(chunkSnapshot);
      deps.onProgress?.report(session.uploadedBytes, fileSize.bytes);
      deps.onEvent?.({ type: 'ChunkUploaded', index });
    }

    // 4. Completar y re-verificar la integridad total (fail-closed).
    const result = await client.complete(sessionId);
    if (!result.verified || result.computedHash !== totalHash.hex) {
      throw new IntegrityError(
        'La verificación de integridad del archivo completo falló al completar (computed_hash no coincide con total_hash).',
      );
    }
    deps.onEvent?.({ type: 'UploadCompleted', verified: result.verified });
    return result;
  } catch (cause) {
    deps.onEvent?.({ type: 'UploadFailed', cause });
    throw cause;
  }
}

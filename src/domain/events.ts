/**
 * Eventos de dominio (decisión D006). Emitidos internamente por la orquestación
 * (B2/B3). El progreso agregado se expone al consumidor vía `ProgressReporter`.
 */
export type DomainEvent =
  | { type: 'ChunkUploaded'; index: number }
  // B3: cada intento fallido de un chunk. `attempt` base 0; `willRetry` indica si
  // habrá reintento. `cause` nunca incluye el `upload_token` ni bytes (SEC-02/03).
  | { type: 'ChunkFailed'; index: number; attempt: number; willRetry: boolean; cause: unknown }
  // B3: sesión reanudable con chunks ya subidos (US-03). `pending` = nº de chunks restantes.
  | { type: 'SessionResumed'; sessionId: string; pending: number }
  // B3: sesión detectada como expirada antes de reiniciar con una nueva (US-08).
  | { type: 'SessionExpired'; sessionId: string }
  | { type: 'UploadCompleted'; verified: boolean }
  | { type: 'UploadFailed'; cause: unknown };

/** Progreso agregado hacia el consumidor: uploaded_bytes / file_size (US-01 AC-4). */
export interface ProgressReporter {
  report(uploadedBytes: number, totalBytes: number): void;
}

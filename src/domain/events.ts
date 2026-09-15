/**
 * Eventos de dominio (decisión D006). Emitidos internamente por la orquestación
 * (B2/B3). El progreso agregado se expone al consumidor vía `ProgressReporter`.
 */
export type DomainEvent =
  | { type: 'ChunkUploaded'; index: number }
  | { type: 'ChunkFailed'; index: number; cause: unknown }
  | { type: 'SessionResumed'; pending: number }
  | { type: 'UploadCompleted'; verified: boolean }
  | { type: 'UploadFailed'; cause: unknown };

/** Progreso agregado hacia el consumidor: uploaded_bytes / file_size (US-01 AC-4). */
export interface ProgressReporter {
  report(uploadedBytes: number, totalBytes: number): void;
}

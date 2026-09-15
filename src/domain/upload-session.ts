import type { UploadPlan } from './upload-plan';

/** Espeja EXACTAMENTE el enum `SessionStatus` del backend (fuente de verdad, D008). */
export type RemoteStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';

/** Fase local de orquestación del cliente (no es un status remoto). */
export type LocalPhase = 'idle' | 'initiating' | 'transferring' | 'finalizing' | 'aborting';

/** Proyección pública de la sesión del backend (allowlist `publicSessionData`). */
export interface RemoteSnapshot {
  status: RemoteStatus;
  pending_chunks: number[];
  uploaded_bytes: number;
  is_expired: boolean;
  remaining_ttl: number;
}

/**
 * Agregado raíz de la sesión (D005). `remoteStatus` solo cambia vía `applyRemote`
 * con datos del backend — el cliente nunca inventa un estado (ARC-03, D008).
 */
export class UploadSession {
  remoteStatus: RemoteStatus = 'pending';
  phase: LocalPhase = 'idle';
  pendingChunks: ReadonlySet<number> = new Set<number>();
  uploadedBytes = 0;
  remainingTtlSeconds?: number;
  expiredDetected = false;

  constructor(
    readonly sessionId: string,
    readonly plan: UploadPlan,
  ) {}

  /** Sincroniza el estado remoto desde una respuesta del backend. */
  applyRemote(snapshot: RemoteSnapshot): void {
    this.remoteStatus = snapshot.status;
    this.pendingChunks = new Set(snapshot.pending_chunks);
    this.uploadedBytes = snapshot.uploaded_bytes;
    this.remainingTtlSeconds = snapshot.remaining_ttl;
    if (snapshot.is_expired) {
      this.expiredDetected = true;
    }
  }

  /** Marca expiración derivada (is_expired=true o 404). No toca `remoteStatus`. */
  markExpired(): void {
    this.expiredDetected = true;
  }

  allChunksUploaded(): boolean {
    return this.pendingChunks.size === 0;
  }

  isResumable(): boolean {
    return (
      !this.expiredDetected &&
      (this.remoteStatus === 'pending' || this.remoteStatus === 'uploading')
    );
  }
}

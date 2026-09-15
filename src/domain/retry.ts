/**
 * Política de reintentos (US-07). Decisión D007: `RetryPolicy` es un VO de
 * configuración (datos) y la lógica vive en funciones puras (`classifyError`,
 * `decideRetry`) — tree-shakeable (EFF-03) y testeable sin I/O (TEST-01).
 */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
  readonly jitter: 'full' | 'none';
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 300,
  factor: 2,
  maxDelayMs: 15000,
  jitter: 'full',
};

export type ErrorKind = 'transient' | 'permanent';

/**
 * Vista normalizada de un fallo, producida por la capa de transporte/orquestación
 * (B2/B3). Es la entrada de la decisión de reintento.
 */
export interface FailureContext {
  /** Código HTTP, si el fallo provino de una respuesta. */
  readonly status?: number;
  /** El transporte lanzó antes de una respuesta (conexión caída, DNS, offline). */
  readonly isNetworkError?: boolean;
  /** La petición superó su presupuesto de tiempo. */
  readonly isTimeout?: boolean;
}

/**
 * Códigos HTTP que merecen reintento aunque no sean 5xx. Es *dato*, no lógica:
 * extender el criterio (p. ej. añadir 503 con semántica especial) se hace aquí,
 * sin tocar `classifyError`. Hoy el backend no emite 429, pero un proxy o gateway
 * intermedio sí puede — de ahí que se contemple (defensivo).
 */
const TRANSIENT_STATUSES = new Set<number>([429]);

/** Clase 5xx: fallo del lado del servidor, reintentable. */
const isServerError = (status: number): boolean => status >= 500 && status <= 599;

/**
 * Clasifica un fallo como transitorio (reintentable) o permanente (no reintentar).
 *
 * Fidelidad de contrato (ARC-03 — códigos verificados en las `ChunkingException`
 * del backend):
 *   - Sin respuesta (isNetworkError / isTimeout)          → 'transient'
 *   - 500 StorageFailureException · 5xx · 429 (proxy)     → 'transient'
 *   - 404 SessionNotFound · 403 Unauthorized · 413 Budget → 'permanent'
 *   - 422 ChunkIndexOOB / ChunkIntegrity · 409 NotReady   → 'permanent'
 *   - 400 (base) y cualquier fallo desconocido            → 'permanent' (conservador)
 */
export function classifyError(failure: FailureContext): ErrorKind {
  if (failure.isNetworkError || failure.isTimeout) return 'transient';
  if (failure.status === undefined) return 'permanent';
  if (isServerError(failure.status)) return 'transient';
  if (TRANSIENT_STATUSES.has(failure.status)) return 'transient';
  return 'permanent';
}

export interface RetryVerdict {
  retry: boolean;
  delayMs: number;
}

/**
 * Decide si reintentar y cuánto esperar. La clasificación transitorio/permanente
 * la delega en `classifyError`; aquí vive el control de intentos y el backoff.
 */
export function decideRetry(
  failure: FailureContext,
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
): RetryVerdict {
  if (classifyError(failure) === 'permanent') {
    return { retry: false, delayMs: 0 };
  }
  if (attempt >= policy.maxRetries) {
    return { retry: false, delayMs: 0 };
  }
  // US-07 AC-5: si el backend indicó Retry-After (típicamente en 429), respétalo.
  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
    return { retry: true, delayMs: retryAfterMs };
  }
  const exponential = policy.baseDelayMs * policy.factor ** attempt;
  const capped = Math.min(policy.maxDelayMs, exponential);
  const delayMs = policy.jitter === 'full' ? Math.random() * capped : capped;
  return { retry: true, delayMs: Math.round(delayMs) };
}

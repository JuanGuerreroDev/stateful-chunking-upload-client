import { decideRetry, type FailureContext, type RetryPolicy } from '../domain/retry';
import { SessionExpiredError, UploadHttpError } from '../errors';

/**
 * Combinador de reintentos (US-07, D014.1). Envuelve un *thunk* asíncrono y, ante
 * fallo, delega la decisión en la política **pura** de B1 (`decideRetry`). No conoce
 * chunks ni HTTP: es genérico y tree-shakeable. El `chunk_index` de un eventual
 * `RetryExhaustedError` lo aporta el llamador (el *worker* de `uploadFile`).
 */
export interface RetryContext {
  policy: RetryPolicy;
  signal?: AbortSignal;
  /** Notificación por intento fallido (para emitir eventos de dominio). */
  onAttemptFailed?: (info: {
    attempt: number;
    error: unknown;
    failure: FailureContext;
    willRetry: boolean;
  }) => void;
}

/** Construye el motivo de aborto: preserva `signal.reason` si es un `Error`. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

/** ¿El error proviene de un `AbortSignal`? (no debe reintentarse). */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Lanza el motivo de aborto si el `signal` ya está abortado. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

/** Espera `ms` de forma cancelable; rechaza con `AbortError` si se aborta antes. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Normaliza un error atrapado al `FailureContext` que consume `classifyError`/`decideRetry`.
 * Extrae también el `retryAfterMs` cuando viene en un `UploadHttpError` (US-07 AC-5).
 */
export function toFailureContext(error: unknown): {
  failure: FailureContext;
  retryAfterMs?: number;
} {
  if (error instanceof UploadHttpError) {
    return { failure: { status: error.status }, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { failure: { isTimeout: true } };
  }
  if (error instanceof TypeError) {
    // `fetch` lanza TypeError ante fallo de red (DNS, conexión rechazada, offline).
    return { failure: { isNetworkError: true } };
  }
  // Desconocido → status indefinido → `classifyError` lo trata como permanente (conservador).
  return { failure: {} };
}

/**
 * Ejecuta `op` con reintentos. Excluye del reintento: abortos (suben para mapearse a
 * `CancelledError`) y `SessionExpiredError` (no es transitorio; lo maneja la capa de
 * sesión de `uploadFile`, US-08 AC-4).
 */
export async function withRetry<T>(op: () => Promise<T>, ctx: RetryContext): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(ctx.signal);
    try {
      return await op();
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof SessionExpiredError) throw error;

      const { failure, retryAfterMs } = toFailureContext(error);
      const verdict = decideRetry(failure, attempt, ctx.policy, retryAfterMs);
      ctx.onAttemptFailed?.({ attempt, error, failure, willRetry: verdict.retry });
      if (!verdict.retry) throw error;

      await abortableDelay(verdict.delayMs, ctx.signal);
    }
  }
}

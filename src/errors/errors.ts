/**
 * Jerarquía de errores tipados del SDK (COD-03 / api-design API-02).
 *
 * `UploadError` es la base abstracta: expone un `code` machine-readable y una
 * `cause` opcional, sin filtrar detalles internos. Toda ruta de error del SDK
 * lanza una de estas subclases, nunca un `Error` genérico.
 */
export abstract class UploadError extends Error {
  abstract readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    // `new.target` da el nombre de la subclase concreta (ES2020).
    this.name = new.target.name;
    this.cause = cause;
    // Restaura la cadena de prototipos para que `instanceof` funcione al transpilar.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** chunkSize inválido (no entero positivo o no múltiplo de 256 KB). US-05 AC-2. */
export class ChunkSizeValidationError extends UploadError {
  readonly code = 'ERR_CHUNK_SIZE_INVALID';
}

/** Probable desajuste de chunkSize con el backend (total_chunks rechazado). US-05 AC-3. */
export class ChunkSizeMismatchError extends UploadError {
  readonly code = 'ERR_CHUNK_SIZE_MISMATCH';
}

/** Archivo vacío (file_size < 1). US-01 AC-7. */
export class EmptyFileError extends UploadError {
  readonly code = 'ERR_EMPTY_FILE';
}

/**
 * `file_name` con forma inválida (charset, longitud o extensión). Fail-fast en
 * cliente, antes de la red (SEC-04, decisión 1A). La política de extensiones
 * *prohibidas* la sigue haciendo cumplir el backend (422), no el SDK.
 */
export class InvalidFileNameError extends UploadError {
  readonly code = 'ERR_INVALID_FILE_NAME';
}

/** Fallo de integridad SHA-256 (chunk o total); fail-closed. US-02. */
export class IntegrityError extends UploadError {
  readonly code = 'ERR_INTEGRITY';
}

/** Web Crypto (`crypto.subtle`) no disponible; fail-fast. US-02 AC-4. (se lanza en B2) */
export class CryptoUnavailableError extends UploadError {
  readonly code = 'ERR_CRYPTO_UNAVAILABLE';
}

/** Sin `fetch` global ni transporte inyectado. US-06 AC-4. (se lanza en B2) */
export class TransportUnavailableError extends UploadError {
  readonly code = 'ERR_TRANSPORT_UNAVAILABLE';
}

/**
 * `baseUrl` con esquema de transporte inseguro. Fail-fast en el borde (SEC-01/NFR-02,
 * D014.3): se permite `https:` siempre y `http:` solo contra loopback
 * (`localhost`/`127.0.0.1`/`[::1]`); cualquier otro caso se rechaza para no filtrar
 * bytes ni el `upload_token` en claro. Sin escape hatch.
 */
export class InsecureTransportError extends UploadError {
  readonly code = 'ERR_INSECURE_TRANSPORT';
}

/** `concurrency` inválido (no entero positivo). Fail-fast client-side. RES-03. */
export class InvalidConcurrencyError extends UploadError {
  readonly code = 'ERR_INVALID_CONCURRENCY';
}

/** Cancelación solicitada por el consumidor (AbortController). US-04. */
export class CancelledError extends UploadError {
  readonly code = 'ERR_CANCELLED';
}

/** Sesión inexistente o expirada. NO es transitorio. US-08 AC-1. */
export class SessionExpiredError extends UploadError {
  readonly code = 'ERR_SESSION_EXPIRED';
}

/** La sesión no es reanudable → iniciar una nueva. US-03 AC-3. */
export class SessionNotResumableError extends UploadError {
  readonly code = 'ERR_SESSION_NOT_RESUMABLE';
}

/** Reintentos agotados para un chunk; incluye el índice y la causa raíz. US-07 AC-4. */
export class RetryExhaustedError extends UploadError {
  readonly code = 'ERR_RETRY_EXHAUSTED';

  constructor(
    readonly chunkIndex: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/**
 * Fallo HTTP sin un mapeo de dominio más específico (ADR-B2-07). Lleva el
 * `status` para que el consumidor (o la política de reintentos de B3) decida.
 * Los errores con semántica propia (integridad, sesión expirada) se mapean a su
 * subclase concreta antes de llegar aquí.
 */
export class UploadHttpError extends UploadError {
  readonly code = 'ERR_HTTP';

  constructor(
    readonly status: number,
    message: string,
    cause?: unknown,
    /**
     * Pista de rate-limit extraída de la cabecera `Retry-After` del 429 (US-07 AC-5).
     * En milisegundos; `undefined` si el backend no la envió → cae al backoff exponencial.
     */
    readonly retryAfterMs?: number,
  ) {
    super(message, cause);
  }
}

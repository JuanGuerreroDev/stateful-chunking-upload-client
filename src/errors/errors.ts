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

/**
 * Entry point público del paquete — browser-safe (B2, decisiones D010/D012).
 *
 * Expone el núcleo, los adaptadores universales y el caso de uso `uploadFile`.
 * El adaptador de Node (`NodeByteSource`, que importa `node:fs`) vive en el
 * subpath `@juanoecr/stateful-chunking-upload-client/node` para que los bundlers
 * de navegador nunca lo resuelvan (EFF-03, ADR-B2-02).
 */

// Clases de error (runtime): permiten `catch (e) { if (e instanceof ...) }`.
export {
  UploadError,
  ChunkSizeValidationError,
  ChunkSizeMismatchError,
  EmptyFileError,
  InvalidFileNameError,
  IntegrityError,
  CryptoUnavailableError,
  TransportUnavailableError,
  InsecureTransportError,
  InvalidConcurrencyError,
  CancelledError,
  SessionExpiredError,
  SessionNotResumableError,
  RetryExhaustedError,
  UploadHttpError,
} from './errors';

// Caso de uso principal.
export { uploadFile } from './application/upload-file';
export type { UploadFileDeps } from './application/upload-file';
export type { CompletionResult } from './adapters/http/chunk-http-client';

// Adaptadores universales (browser-safe).
export { WebCryptoHasher } from './adapters/web-crypto-hasher';
export { BlobByteSource } from './adapters/blob-byte-source';

// Tipos y puertos (borrados en runtime): contratos que el consumidor provee/observa.
export type { Transport } from './ports/transport';
export type { ByteSource } from './ports/byte-source';
export type { Hasher } from './ports/hasher';
export type { RetryPolicy } from './domain/retry';
// Política de reintentos por defecto: base para overrides (`{ ...DEFAULT_RETRY_POLICY, maxRetries: 5 }`).
export { DEFAULT_RETRY_POLICY } from './domain/retry';
export type { ProgressReporter, DomainEvent } from './domain/events';
export type { RemoteStatus } from './domain/upload-session';

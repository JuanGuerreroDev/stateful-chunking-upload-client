/**
 * Entry point público del paquete (B1 — superficie progresiva, decisión D010/1B).
 *
 * B1 expone SOLO las clases de error y los tipos/puertos que el consumidor
 * necesita para tipar y capturar. El `UploadClient` ensamblador se añadirá en B2,
 * cuando existan los adaptadores.
 */

// Clases de error (runtime): permiten `catch (e) { if (e instanceof ...) }`.
export {
  UploadError,
  ChunkSizeValidationError,
  ChunkSizeMismatchError,
  EmptyFileError,
  IntegrityError,
  CryptoUnavailableError,
  TransportUnavailableError,
  CancelledError,
  SessionExpiredError,
  SessionNotResumableError,
  RetryExhaustedError,
} from './errors';

// Tipos y puertos (borrados en runtime): contratos que el consumidor provee/observa.
export type { Transport } from './ports/transport';
export type { ByteSource } from './ports/byte-source';
export type { Hasher } from './ports/hasher';
export type { RetryPolicy } from './domain/retry';
export type { ProgressReporter, DomainEvent } from './domain/events';
export type { RemoteStatus } from './domain/upload-session';

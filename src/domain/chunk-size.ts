import { ChunkSizeValidationError } from '../errors';

/**
 * Tamaño de chunk (US-05). Invariantes validadas al construir (SEC-04, fail-fast):
 * entero positivo y múltiplo de 256 KB. Debe coincidir con `chunk_size_bytes` del backend.
 */
export class ChunkSize {
  /** 256 KB — el backend exige múltiplos de este valor (VO `ChunkSize`). */
  static readonly MULTIPLE = 262144;
  /** 2 MiB — default del backend. */
  static readonly DEFAULT = 2097152;

  private constructor(readonly bytes: number) {}

  static of(bytes: number = ChunkSize.DEFAULT): ChunkSize {
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new ChunkSizeValidationError(
        `chunkSize debe ser un entero positivo; recibido: ${bytes}`,
      );
    }
    if (bytes % ChunkSize.MULTIPLE !== 0) {
      throw new ChunkSizeValidationError(
        `chunkSize debe ser múltiplo de ${ChunkSize.MULTIPLE} bytes (256 KB); recibido: ${bytes}`,
      );
    }
    return new ChunkSize(bytes);
  }
}

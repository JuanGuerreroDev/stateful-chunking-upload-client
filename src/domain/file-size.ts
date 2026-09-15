import { EmptyFileError } from '../errors';

/**
 * Tamaño de archivo (US-01 AC-7). El backend exige `file_size >= 1`; el SDK lo
 * rechaza client-side (fail-fast, sin round-trip).
 */
export class FileSize {
  private constructor(readonly bytes: number) {}

  static of(bytes: number): FileSize {
    if (!Number.isInteger(bytes) || bytes < 1) {
      throw new EmptyFileError(`file_size debe ser un entero >= 1; recibido: ${bytes}`);
    }
    return new FileSize(bytes);
  }
}

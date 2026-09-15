import type { FileSize } from './file-size';
import type { Sha256Hash } from './sha256-hash';

/**
 * Huella estable de un archivo (US-03). El backend la usa para reconocer una
 * sesión reanudable del mismo archivo.
 */
export class FileFingerprint {
  private constructor(readonly value: string) {}

  static of(value: string): FileFingerprint {
    if (value.length === 0) {
      throw new TypeError('fingerprint no puede ser vacío');
    }
    return new FileFingerprint(value);
  }
}

/**
 * Derivación por defecto: estable **por archivo** (AF-005). Combina nombre,
 * tamaño y hash total — nunca identidad de usuario ni de lote, para no compartir
 * sesión entre archivos distintos.
 */
export function deriveFingerprint(
  fileName: string,
  fileSize: FileSize,
  totalHash: Sha256Hash,
): FileFingerprint {
  return FileFingerprint.of(`${fileName}:${fileSize.bytes}:${totalHash.hex}`);
}

import { InvalidFileNameError } from '../errors';

/** Charset permitido por el backend en `/initiate` (InitiateChunkRequest). */
const ALLOWED = /^[a-zA-Z0-9._-]+$/;
const MAX_LENGTH = 255;

/**
 * Validación **estructural** de `file_name` (decisión 1A, SEC-04, ADR-B2-06).
 *
 * Falla-rápido en cliente, sin round-trip, cuando el nombre no puede ser válido
 * por su *forma*. Deliberadamente NO replica la lista de extensiones prohibidas
 * del backend: esa política se comprueba en el servidor (422) para no arrastrar
 * *drift* si cambia. El cliente solo garantiza que el nombre sea bien formado.
 *
 * Reglas (subconjunto estable de las del backend):
 * - charset `[a-zA-Z0-9._-]`, longitud 1–255;
 * - sin punto inicial (nada de dotfiles ni rutas relativas);
 * - sin punto final;
 * - al menos una extensión (un punto interior con caracteres a cada lado).
 */
export function validateFileName(fileName: string): void {
  if (fileName.length === 0 || fileName.length > MAX_LENGTH) {
    throw new InvalidFileNameError(
      `file_name debe tener entre 1 y ${MAX_LENGTH} caracteres; recibido: ${fileName.length}.`,
    );
  }
  if (!ALLOWED.test(fileName)) {
    throw new InvalidFileNameError(
      'file_name contiene caracteres no permitidos (solo se aceptan letras, dígitos, punto, guion y guion bajo).',
    );
  }
  if (fileName.startsWith('.')) {
    throw new InvalidFileNameError('file_name no puede empezar por punto.');
  }
  if (fileName.endsWith('.')) {
    throw new InvalidFileNameError('file_name no puede terminar en punto.');
  }
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    throw new InvalidFileNameError('file_name debe incluir una extensión (p. ej. "video.mp4").');
  }
}

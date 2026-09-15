import { describe, it, expect } from 'vitest';
import { validateFileName } from '../../src/application/validate-file-name';
import { InvalidFileNameError } from '../../src/errors';

describe('validateFileName (1A, SEC-04)', () => {
  it('acepta nombres bien formados', () => {
    expect(() => validateFileName('video.mp4')).not.toThrow();
    expect(() => validateFileName('my_file-01.tar.gz')).not.toThrow();
    expect(() => validateFileName('a.b')).not.toThrow();
  });

  it('rechaza charset no permitido (espacios, barras, unicode)', () => {
    expect(() => validateFileName('my file.mp4')).toThrow(InvalidFileNameError);
    expect(() => validateFileName('dir/video.mp4')).toThrow(InvalidFileNameError);
    expect(() => validateFileName('vidéo.mp4')).toThrow(InvalidFileNameError);
  });

  it('rechaza vacío y > 255 caracteres', () => {
    expect(() => validateFileName('')).toThrow(InvalidFileNameError);
    expect(() => validateFileName(`${'a'.repeat(255)}.mp4`)).toThrow(InvalidFileNameError);
  });

  it('rechaza punto inicial (dotfiles / rutas relativas)', () => {
    expect(() => validateFileName('.env')).toThrow(InvalidFileNameError);
    expect(() => validateFileName('..')).toThrow(InvalidFileNameError);
  });

  it('rechaza punto final y ausencia de extensión', () => {
    expect(() => validateFileName('video.')).toThrow(InvalidFileNameError);
    expect(() => validateFileName('README')).toThrow(InvalidFileNameError);
  });

  it('NO replica la lista de extensiones prohibidas (eso lo hace el backend)', () => {
    // Una extensión "peligrosa" bien formada pasa la validación estructural del
    // cliente; el rechazo por política vive en el backend (422), no aquí.
    expect(() => validateFileName('malware.exe')).not.toThrow();
  });
});

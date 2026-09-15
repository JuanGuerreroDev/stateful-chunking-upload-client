import { describe, it, expect } from 'vitest';
import { FileSize } from '../../src/domain/file-size';
import { EmptyFileError } from '../../src/errors';

describe('FileSize (US-01 AC-7)', () => {
  it('acepta tamaños >= 1', () => {
    expect(FileSize.of(1).bytes).toBe(1);
    expect(FileSize.of(1048576).bytes).toBe(1048576);
  });

  it('rechaza archivo vacío (0 bytes) con EmptyFileError', () => {
    expect(() => FileSize.of(0)).toThrow(EmptyFileError);
  });

  it('rechaza negativos y no-enteros', () => {
    expect(() => FileSize.of(-1)).toThrow(EmptyFileError);
    expect(() => FileSize.of(3.14)).toThrow(EmptyFileError);
  });
});

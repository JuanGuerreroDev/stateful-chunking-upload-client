import { describe, it, expect } from 'vitest';
import { ChunkSize } from '../../src/domain/chunk-size';
import { ChunkSizeValidationError } from '../../src/errors';

describe('ChunkSize (US-05)', () => {
  it('AC-1: usa 2 MiB por defecto', () => {
    expect(ChunkSize.of().bytes).toBe(2097152);
  });

  it('AC-1: acepta un múltiplo válido de 256 KB', () => {
    expect(ChunkSize.of(262144).bytes).toBe(262144);
    expect(ChunkSize.of(262144 * 5).bytes).toBe(262144 * 5);
  });

  it('AC-2: rechaza un tamaño que no es múltiplo de 256 KB', () => {
    expect(() => ChunkSize.of(262144 + 1)).toThrow(ChunkSizeValidationError);
  });

  it('AC-2: rechaza no-enteros y no-positivos', () => {
    expect(() => ChunkSize.of(0)).toThrow(ChunkSizeValidationError);
    expect(() => ChunkSize.of(-262144)).toThrow(ChunkSizeValidationError);
    expect(() => ChunkSize.of(1024.5)).toThrow(ChunkSizeValidationError);
  });

  it('AC-2: el error nombra el requisito de múltiplo (diagnóstico)', () => {
    expect(() => ChunkSize.of(300000)).toThrow(/múltiplo de 262144/);
  });
});

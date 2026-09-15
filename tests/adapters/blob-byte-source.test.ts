import { describe, it, expect } from 'vitest';
import { BlobByteSource } from '../../src/adapters/blob-byte-source';

describe('BlobByteSource (US-01)', () => {
  const data = new Uint8Array([10, 20, 30, 40, 50]);
  const source = new BlobByteSource(new Blob([data]));

  it('size() = tamaño del blob', () => {
    expect(source.size()).toBe(5);
  });

  it('slice([start, end)) devuelve solo el rango', async () => {
    expect(Array.from(await source.slice(1, 3))).toEqual([20, 30]);
    expect(Array.from(await source.slice(0, 5))).toEqual([10, 20, 30, 40, 50]);
  });

  it('slice más allá del final se recorta al tamaño real', async () => {
    expect(Array.from(await source.slice(3, 999))).toEqual([40, 50]);
  });
});

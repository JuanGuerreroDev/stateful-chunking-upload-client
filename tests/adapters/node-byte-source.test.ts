import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeByteSource } from '../../src/adapters/node-byte-source';

describe('NodeByteSource (US-01, ADR-B2-08)', () => {
  const path = join(tmpdir(), `scuc-node-byte-source-${Date.now()}.bin`);
  // 300 bytes con valor = índice % 256, para verificar rangos por contenido.
  const data = new Uint8Array(300).map((_, i) => i % 256);

  beforeAll(async () => {
    await writeFile(path, data);
  });
  afterAll(async () => {
    await unlink(path);
  });

  it('size() = tamaño real del archivo', async () => {
    const source = await NodeByteSource.of(path);
    expect(source.size()).toBe(300);
  });

  it('slice devuelve el rango exacto [start, end)', async () => {
    const source = await NodeByteSource.of(path);
    const chunk = await source.slice(0, 128);
    expect(chunk.length).toBe(128);
    expect(Array.from(chunk)).toEqual(Array.from(data.subarray(0, 128)));
  });

  it('el último chunk (parcial) se lee completo vía short-read loop', async () => {
    const source = await NodeByteSource.of(path);
    const last = await source.slice(256, 300); // 44 bytes, cruza límites de lectura
    expect(last.length).toBe(44);
    expect(Array.from(last)).toEqual(Array.from(data.subarray(256, 300)));
  });

  it('un rango vacío devuelve un buffer vacío sin abrir el archivo', async () => {
    const source = await NodeByteSource.of(path);
    expect((await source.slice(10, 10)).length).toBe(0);
  });

  it('leer más allá del final se recorta a los bytes disponibles (EOF)', async () => {
    const source = await NodeByteSource.of(path);
    const beyond = await source.slice(290, 400);
    expect(beyond.length).toBe(10);
  });
});

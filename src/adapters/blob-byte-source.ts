import type { ByteSource } from '../ports/byte-source';

/**
 * Adaptador de `ByteSource` sobre `Blob`/`File` (US-01, EFF-02, ADR-B2-02).
 *
 * Es el adaptador por defecto en navegador: `File` extiende `Blob`, así que un
 * `<input type="file">` encaja directo. `Blob.slice(start, end)` es *lazy* —
 * no copia bytes hasta que se lee — y `arrayBuffer()` materializa solo el rango
 * pedido, nunca el archivo completo (EFF-02).
 *
 * No importa nada de `node:*`, por lo que vive en el entry principal
 * (browser-safe). El equivalente para Node es `NodeByteSource` (entry `./node`).
 */
export class BlobByteSource implements ByteSource {
  constructor(private readonly blob: Blob) {}

  size(): number {
    return this.blob.size;
  }

  async slice(start: number, end: number): Promise<Uint8Array> {
    const buffer = await this.blob.slice(start, end).arrayBuffer();
    return new Uint8Array(buffer);
  }
}

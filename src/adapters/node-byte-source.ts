import { open } from 'node:fs/promises';
import type { ByteSource } from '../ports/byte-source';

/**
 * Adaptador de `ByteSource` sobre el sistema de archivos de Node (US-01, EFF-02,
 * ADR-B2-02/08).
 *
 * Vive en el entry `@juanoecr/stateful-chunking-upload-client/node`: es el único
 * módulo del SDK que importa `node:fs`, por lo que un bundler de navegador que
 * use el entry principal nunca lo resuelve (EFF-03).
 *
 * Lee por rangos con `FileHandle.read`. **Gotcha (ADR-B2-08):** `read` puede
 * devolver *menos* bytes de los pedidos sin haber llegado a EOF, así que se
 * itera (*short-read loop*) hasta llenar el buffer o agotar el archivo.
 *
 * Abre y cierra un descriptor por `slice` (subida secuencial en B2): así no se
 * fuga ningún file descriptor ni se le impone al consumidor un ciclo de vida.
 *
 * **Seguridad:** `filePath` procede del consumidor (igual que `fs.readFile`). Si
 * proviene de entrada no confiable, el path traversal es responsabilidad del
 * llamador. Superficie revisada en `/security-review` (Stage 5, R-06).
 */
export class NodeByteSource implements ByteSource {
  private constructor(
    private readonly filePath: string,
    private readonly byteLength: number,
  ) {}

  /** Abre el archivo para conocer su tamaño (requerido por `size()`, síncrono). */
  static async of(filePath: string): Promise<NodeByteSource> {
    const handle = await open(filePath, 'r');
    try {
      const stats = await handle.stat();
      return new NodeByteSource(filePath, stats.size);
    } finally {
      await handle.close();
    }
  }

  size(): number {
    return this.byteLength;
  }

  async slice(start: number, end: number): Promise<Uint8Array> {
    const length = end - start;
    const buffer = new Uint8Array(Math.max(length, 0));
    if (length <= 0) {
      return buffer;
    }

    const handle = await open(this.filePath, 'r');
    try {
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(buffer, {
          offset: filled,
          length: length - filled,
          position: start + filled,
        });
        if (bytesRead === 0) {
          break; // EOF real: el archivo es más corto de lo esperado.
        }
        filled += bytesRead;
      }
      return filled === length ? buffer : buffer.subarray(0, filled);
    } finally {
      await handle.close();
    }
  }
}

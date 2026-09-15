/**
 * Puerto de fuente de bytes troceable (ARC-01, EFF-02).
 *
 * Abstrae el origen del archivo (File/Blob en web, Buffer/fs en Node). El SDK
 * lee por rangos [start, end) sin cargar el archivo completo en memoria. Los
 * adaptadores concretos llegan en B2.
 */
export interface ByteSource {
  /** Tamaño total en bytes. */
  size(): number;
  /** Devuelve los bytes del rango [start, end). */
  slice(start: number, end: number): Promise<Uint8Array>;
}

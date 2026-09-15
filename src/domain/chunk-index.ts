/**
 * Índice de chunk, base 0. Invariante interna: entero >= 0.
 */
export class ChunkIndex {
  private constructor(readonly value: number) {}

  static of(value: number): ChunkIndex {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`chunk_index debe ser un entero >= 0; recibido: ${value}`);
    }
    return new ChunkIndex(value);
  }
}

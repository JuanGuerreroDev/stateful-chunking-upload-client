/**
 * Hash SHA-256 en hexadecimal (64 caracteres, minúscula). Usado para
 * `chunk_hash`, `total_hash` y comparación con `computed_hash`.
 */
export class Sha256Hash {
  private static readonly HEX = /^[0-9a-f]{64}$/;

  private constructor(readonly hex: string) {}

  static of(hex: string): Sha256Hash {
    const normalized = hex.toLowerCase();
    if (!Sha256Hash.HEX.test(normalized)) {
      throw new TypeError(`SHA-256 inválido (se esperan 64 caracteres hex); recibido: ${hex}`);
    }
    return new Sha256Hash(normalized);
  }
}

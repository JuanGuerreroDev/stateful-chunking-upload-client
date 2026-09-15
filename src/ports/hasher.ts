/**
 * Puerto de hashing SHA-256 (EFF-01, US-02).
 *
 * El adaptador de B2 lo implementa con Web Crypto (`crypto.subtle.digest`).
 * Devuelve el hash en hexadecimal en minúscula.
 */
export interface Hasher {
  sha256(bytes: Uint8Array): Promise<string>;
}

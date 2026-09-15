import type { Hasher } from '../ports/hasher';
import { CryptoUnavailableError } from '../errors';

/**
 * Adaptador de `Hasher` sobre Web Crypto (US-02, EFF-01, ADR-B2-01).
 *
 * `crypto.subtle.digest('SHA-256', ...)` es el mismo estándar (SubtleCrypto) en
 * navegador y Node ≥18, por lo que no hay ramas por plataforma. Es *one-shot*:
 * hasheamos un chunk completo por llamada — nunca el archivo entero (el
 * `total_hash` lo aporta el consumidor, ver ADR-B2-01).
 *
 * *Fail-fast* (US-02 AC-4): si `crypto.subtle` no existe (contexto no seguro,
 * p. ej. una página HTTP sin TLS) lanza `CryptoUnavailableError` al construir,
 * antes de iniciar cualquier subida.
 */
export class WebCryptoHasher implements Hasher {
  private readonly subtle: SubtleCrypto;

  constructor(cryptoImpl: Crypto | undefined = globalThis.crypto) {
    const subtle = cryptoImpl?.subtle;
    if (!subtle) {
      throw new CryptoUnavailableError(
        'Web Crypto (crypto.subtle) no está disponible; se requiere un contexto seguro (HTTPS) o Node ≥18.',
      );
    }
    this.subtle = subtle;
  }

  async sha256(bytes: Uint8Array): Promise<string> {
    // Copia a un Uint8Array respaldado por un ArrayBuffer propio (no compartido):
    // garantiza el tipo `BufferSource` que exige `digest` y evita SharedArrayBuffer.
    const data = new Uint8Array(bytes);
    const digest = await this.subtle.digest('SHA-256', data);
    return toHex(digest);
  }
}

/** ArrayBuffer → hexadecimal en minúscula (64 chars para SHA-256). */
function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

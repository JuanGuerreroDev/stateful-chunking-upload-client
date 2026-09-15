import { describe, it, expect } from 'vitest';
import { WebCryptoHasher } from '../../src/adapters/web-crypto-hasher';
import { CryptoUnavailableError } from '../../src/errors';

describe('WebCryptoHasher (US-02)', () => {
  it('calcula SHA-256 en hex minúscula (vector conocido "abc")', async () => {
    const hasher = new WebCryptoHasher();
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
    const hex = await hasher.sha256(bytes);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hash del vector vacío', async () => {
    const hex = await new WebCryptoHasher().sha256(new Uint8Array(0));
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('fail-fast si no hay crypto.subtle (contexto no seguro)', () => {
    // Un Crypto sin `subtle` simula una página HTTP sin TLS.
    expect(() => new WebCryptoHasher({} as Crypto)).toThrow(CryptoUnavailableError);
    expect(() => new WebCryptoHasher(undefined)).not.toThrow(); // Node ≥18 sí tiene subtle
  });
});

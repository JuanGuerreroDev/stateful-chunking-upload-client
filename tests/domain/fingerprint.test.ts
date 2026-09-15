import { describe, it, expect } from 'vitest';
import { deriveFingerprint } from '../../src/domain/fingerprint';
import { FileSize } from '../../src/domain/file-size';
import { Sha256Hash } from '../../src/domain/sha256-hash';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('deriveFingerprint (US-03 AC-4, AF-005)', () => {
  it('es estable para el mismo archivo', () => {
    const fp1 = deriveFingerprint('a.bin', FileSize.of(1000), Sha256Hash.of(HASH_A));
    const fp2 = deriveFingerprint('a.bin', FileSize.of(1000), Sha256Hash.of(HASH_A));
    expect(fp1.value).toBe(fp2.value);
  });

  it('difiere para archivos distintos (no comparten sesión)', () => {
    const fp1 = deriveFingerprint('a.bin', FileSize.of(1000), Sha256Hash.of(HASH_A));
    const fpDistinctName = deriveFingerprint('b.bin', FileSize.of(1000), Sha256Hash.of(HASH_A));
    const fpDistinctSize = deriveFingerprint('a.bin', FileSize.of(2000), Sha256Hash.of(HASH_A));
    const fpDistinctHash = deriveFingerprint('a.bin', FileSize.of(1000), Sha256Hash.of(HASH_B));
    expect(new Set([
      fp1.value, fpDistinctName.value, fpDistinctSize.value, fpDistinctHash.value,
    ]).size).toBe(4);
  });
});

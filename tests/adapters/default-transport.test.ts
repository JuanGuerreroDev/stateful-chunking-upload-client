import { describe, it, expect, vi } from 'vitest';
import { resolveTransport } from '../../src/adapters/http/default-transport';
import type { Transport } from '../../src/ports/transport';
import { TransportUnavailableError } from '../../src/errors';

describe('resolveTransport (US-06, ADR-B2-03)', () => {
  it('usa el transporte inyectado tal cual (auth fuera del SDK)', () => {
    const injected: Transport = vi.fn();
    expect(resolveTransport(injected)).toBe(injected);
  });

  it('cae a globalThis.fetch si no se inyecta (Node ≥20 / navegador)', () => {
    expect(typeof resolveTransport()).toBe('function');
  });

  it('fail-fast con TransportUnavailableError si no hay fetch global', () => {
    const original = globalThis.fetch;
    // Simula un entorno sin fetch (p. ej. Node <20 sin polyfill).
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try {
      expect(() => resolveTransport()).toThrow(TransportUnavailableError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

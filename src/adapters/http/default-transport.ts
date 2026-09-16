import type { Transport } from '../../ports/transport';
import { TransportUnavailableError } from '../../errors';

/**
 * Resuelve el `Transport` efectivo (US-06, ADR-B2-03).
 *
 * Si el consumidor inyecta uno (típicamente un `fetch` envuelto con auth), se usa
 * tal cual — el SDK nunca añade cabeceras de autenticación (SEC-06). Si no, cae a
 * `globalThis.fetch` (nativo en navegador y Node ≥20).
 *
 * *Fail-fast* (US-06 AC-4): si no hay ni transporte inyectado ni `fetch` global,
 * lanza `TransportUnavailableError` en lugar de fallar opacamente más tarde.
 */
export function resolveTransport(injected?: Transport): Transport {
  if (injected) {
    return injected;
  }
  const globalFetch = globalThis.fetch;
  if (typeof globalFetch !== 'function') {
    throw new TransportUnavailableError(
      'No se inyectó Transport y no hay fetch global disponible; provee uno explícito (Node <20 requiere un polyfill).',
    );
  }
  // Enlazado a globalThis: algunos entornos exigen que `fetch` conserve su `this`.
  return globalFetch.bind(globalThis);
}

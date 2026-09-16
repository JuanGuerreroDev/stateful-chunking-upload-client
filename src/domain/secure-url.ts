import { InsecureTransportError } from '../errors';

/**
 * Enforcement de transporte seguro (SEC-01 / NFR-02, D014.3).
 *
 * Función **pura** de borde (sin I/O → tree-shakeable y testeable sin red). Se
 * invoca fail-fast en `uploadFile` y en el constructor de `ChunkHttpClient`
 * (defensa en profundidad). Política **estricta, sin escape hatch**:
 *   - `https:` → siempre permitido.
 *   - `http:`  → solo contra loopback (`localhost`/`127.0.0.1`/`[::1]`), para el
 *               testbench local del backend.
 *   - resto    → `InsecureTransportError` (evita filtrar bytes/`upload_token` en claro).
 */

/** `URL.hostname` de un host loopback (IPv6 llega entre corchetes). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function assertSecureBaseUrl(baseUrl: string | URL): void {
  let url: URL;
  try {
    url = baseUrl instanceof URL ? baseUrl : new URL(baseUrl);
  } catch {
    throw new InsecureTransportError(
      'baseUrl no es una URL válida: no se pudo verificar el esquema de transporte.',
    );
  }

  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return;

  throw new InsecureTransportError(
    `Transporte inseguro rechazado: '${url.protocol}//${url.host}'. ` +
      'Usa https:, o http: únicamente contra localhost/127.0.0.1/[::1].',
  );
}

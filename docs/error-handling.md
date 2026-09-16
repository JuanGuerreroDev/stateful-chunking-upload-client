# Manejo de errores

Todos los errores que lanza el SDK extienden la clase base abstracta `UploadError` y exponen:

- `code`: string legible por máquina (p. ej. `ERR_INTEGRITY`), estable para lógica y logs.
- `message`: descripción legible por humanos.
- `cause?`: causa subyacente opcional, sin filtrar detalles internos ni secretos.

Nunca se lanza un `Error` genérico desde el SDK.

## Patrón de captura

```ts
import {
  UploadError,
  CancelledError,
  IntegrityError,
  SessionExpiredError,
} from '@juanoecr/stateful-chunking-upload-client';

try {
  const result = await uploadFile(deps);
  // éxito
} catch (e) {
  if (e instanceof CancelledError) {
    // El usuario canceló: no es un fallo.
  } else if (e instanceof IntegrityError) {
    mostrar('El archivo se corrompió durante la subida. Intenta de nuevo.');
  } else if (e instanceof UploadError) {
    // Cualquier otro error tipado del SDK.
    reportar(e.code, e.message);
  } else {
    throw e; // no proviene del SDK
  }
}
```

Discrimina por `instanceof` (para ramificar la lógica) y usa `code` para logs y métricas (es estable aunque se minifique el `name`).

## Taxonomía

### Errores de validación en cliente (fail-fast, antes de la red)

Indican un uso incorrecto o entrada inválida. Se corrigen en tu código; no tiene sentido reintentar.

| Clase | `code` | Causa y acción |
|-------|--------|----------------|
| `ChunkSizeValidationError` | `ERR_CHUNK_SIZE_INVALID` | `chunkSize` no entero positivo o no múltiplo de 256 KB. Corrige el valor. |
| `InvalidConcurrencyError` | `ERR_INVALID_CONCURRENCY` | `concurrency` no entero ≥ 1. Corrige el valor. |
| `InvalidFileNameError` | `ERR_INVALID_FILE_NAME` | `fileName` con forma inválida. Sanea el nombre. |
| `EmptyFileError` | `ERR_EMPTY_FILE` | Archivo vacío. Valida antes de subir. |
| `InsecureTransportError` | `ERR_INSECURE_TRANSPORT` | `baseUrl` con esquema inseguro. Usa `https:` (o `http:` solo en loopback). |
| `CryptoUnavailableError` | `ERR_CRYPTO_UNAVAILABLE` | Sin `crypto.subtle` (contexto no seguro). Sirve por HTTPS o usa Node ≥ 20. |
| `TransportUnavailableError` | `ERR_TRANSPORT_UNAVAILABLE` | Sin `fetch` global ni `transport` inyectado. Provee un `transport`. |

### Errores de entorno/contrato

| Clase | `code` | Causa y acción |
|-------|--------|----------------|
| `ChunkSizeMismatchError` | `ERR_CHUNK_SIZE_MISMATCH` | El backend rechazó `total_chunks`: probable desajuste de `chunkSize`. Alinea el `chunkSize` con el backend. |
| `IntegrityError` | `ERR_INTEGRITY` | Fallo de verificación SHA-256 (chunk o total). Fail-closed. Reintentar la subida completa suele resolver si fue corrupción en tránsito. |

### Errores de sesión (ciclo de vida)

| Clase | `code` | Causa y acción |
|-------|--------|----------------|
| `SessionExpiredError` | `ERR_SESSION_EXPIRED` | Sesión inexistente o expirada tras el reinicio automático. Vuelve a intentar la subida desde cero. |
| `SessionNotResumableError` | `ERR_SESSION_NOT_RESUMABLE` | La sesión no es reanudable. Reintenta como subida nueva. |
| `CancelledError` | `ERR_CANCELLED` | Cancelación vía `AbortSignal`. No es un fallo; no lo muestres como error. |

### Errores de transporte/HTTP

| Clase | `code` | Detalle |
|-------|--------|---------|
| `RetryExhaustedError` | `ERR_RETRY_EXHAUSTED` | Un chunk agotó sus reintentos. Incluye `chunkIndex` y la `cause` raíz. Considera reintentar la sesión (reanuda pendientes). |
| `UploadHttpError` | `ERR_HTTP` | Fallo HTTP sin mapeo específico. Incluye `status`; en un 429 incluye `retryAfterMs`. |

## Qué conviene reintentar

El SDK ya reintenta internamente los fallos transitorios a nivel de chunk. A nivel de **sesión**, desde tu app:

- **Reintentar la sesión**: `RetryExhaustedError`, `IntegrityError`, `SessionExpiredError`, `SessionNotResumableError`. Vuelve a llamar `uploadFile` con los mismos `fileName`/`fileSize`/`totalHash`: reanudará los chunks pendientes si el backend aún reconoce el archivo, o reiniciará desde cero si la sesión expiró o no es reanudable.
- **No reintentar** (corrige y vuelve): los errores de validación en cliente.
- **No es error**: `CancelledError`.

## Acceder a metadatos específicos

Algunos errores llevan datos extra útiles para diagnóstico o UX:

```ts
import { RetryExhaustedError, UploadHttpError } from '@juanoecr/stateful-chunking-upload-client';

catch (e) {
  if (e instanceof RetryExhaustedError) {
    console.error(`Chunk ${e.chunkIndex} agotó reintentos`, e.cause);
  } else if (e instanceof UploadHttpError) {
    console.error(`HTTP ${e.status}`, e.retryAfterMs);
  }
}
```

## Logging seguro

Registra `code`, `message` y (si aplica) `status`/`chunkIndex`. Evita volcar `cause` sin filtrar o cualquier cuerpo de petición: podrían contener el `upload_token` u otros datos sensibles. El SDK ya mantiene esos secretos fuera de sus eventos y mensajes de error.

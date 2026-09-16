# @juanoecr/stateful-chunking-upload-client

> SDK cliente en TypeScript, agnóstico de framework, para subir archivos por chunks al backend [`juanoecr/stateful-chunking-upload`](https://github.com/JuanGuerreroDev/stateful-chunking-upload) con verificación de integridad, reanudación y cancelación.

[![npm version](https://img.shields.io/npm/v/@juanoecr/stateful-chunking-upload-client.svg)](https://www.npmjs.com/package/@juanoecr/stateful-chunking-upload-client)
[![CI](https://github.com/JuanGuerreroDev/stateful-chunking-upload-client/actions/workflows/ci.yml/badge.svg)](https://github.com/JuanGuerreroDev/stateful-chunking-upload-client/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Trocea el archivo, sube los chunks en paralelo verificando su hash SHA-256, reanuda subidas interrumpidas subiendo **solo** los chunks pendientes y cancela de forma limpia. Es **documentación ejecutable** del flujo `initiate → upload → complete`: en vez de reimplementar el cliente en cada app, consumes este.

- **Agnóstico de framework** — funciona en navegador y Node; sin acoplamiento a React/Vue/etc.
- **Integridad fail-closed** — SHA-256 por chunk (Web Crypto nativo) + re-verificación al completar.
- **Reanudable** — retoma una subida interrumpida sin resubir lo ya confirmado.
- **Cancelable** — `AbortSignal` estándar + purga del backend (`/cancel`).
- **Resiliente** — reintentos con backoff exponencial + jitter, honra `Retry-After`.
- **Cero dependencias de runtime** — núcleo browser tree-shakeable (< 10 KB min+gzip, verificado en CI).
- **ESM + CJS + tipos** — `.d.ts` duales, subpath exports.

## Documentación

Guías de integración detalladas en [`docs/`](./docs/README.md): [primeros pasos](./docs/getting-started.md), [autenticación](./docs/authentication.md), [ciclo de vida y resiliencia](./docs/lifecycle-and-resiliency.md) y [manejo de errores](./docs/error-handling.md).

## Requisitos

- **Node ≥ 20** o un navegador moderno (el SDK usa `globalThis.crypto`, `globalThis.fetch` y `AbortSignal` nativos).
- Un backend [`juanoecr/stateful-chunking-upload`](https://github.com/JuanGuerreroDev/stateful-chunking-upload) en ejecución.
- El `chunkSize` del cliente **debe coincidir** con el configurado en el backend (default **2 MiB**).

## Instalación

```bash
pnpm add @juanoecr/stateful-chunking-upload-client
```

## Inicio rápido

### Navegador (`File` / `Blob`)

```ts
import {
  uploadFile,
  WebCryptoHasher,
  BlobByteSource,
} from '@juanoecr/stateful-chunking-upload-client';

const file = fileInput.files[0]; // <input type="file">
const hasher = new WebCryptoHasher();

// El SDK no calcula el hash del archivo completo: lo aportas tú.
// Puedes reutilizar el propio WebCryptoHasher sobre los bytes completos.
const totalHash = await hasher.sha256(new Uint8Array(await file.arrayBuffer()));

const result = await uploadFile({
  baseUrl: 'https://api.example.com/api/chunks', // incluye el prefijo del backend
  source: new BlobByteSource(file),
  hasher,
  fileName: file.name,
  totalHash,
  onProgress: { report: (uploaded, total) => console.log(`${uploaded}/${total}`) },
});

console.log(result.verified);     // true → integridad confirmada por el backend
console.log(result.uploadToken);  // token de staging (NO lo persiste el SDK)
```

### Node (ruta de archivo, sin cargarlo entero en memoria)

```ts
import { uploadFile, WebCryptoHasher } from '@juanoecr/stateful-chunking-upload-client';
import { NodeByteSource } from '@juanoecr/stateful-chunking-upload-client/node';
import { readFile } from 'node:fs/promises';

const path = './video.mp4';
const hasher = new WebCryptoHasher();
const totalHash = await hasher.sha256(new Uint8Array(await readFile(path)));

const result = await uploadFile({
  baseUrl: 'https://api.example.com/api/chunks',
  source: await NodeByteSource.of(path), // lee por rangos [start, end), no todo de golpe
  hasher,
  fileName: 'video.mp4',
  totalHash,
});
```

> **Nota sobre `totalHash`:** el SDK no hashea el archivo completo por ti (decisión de diseño: no imponer una estrategia). Los ejemplos hashean todo el archivo en memoria por simplicidad; para archivos muy grandes, computa el SHA-256 de forma incremental/streaming en tu app y pásalo como `totalHash`.

## Autenticación

El SDK **no** conoce ni añade cabeceras de autenticación (es responsabilidad de tu app). Inyecta un `transport` compatible con `fetch` que las añada:

```ts
import type { Transport } from '@juanoecr/stateful-chunking-upload-client';

const transport: Transport = (input, init) =>
  fetch(input, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });

await uploadFile({ /* ...deps... */, transport });
```

Si omites `transport`, el SDK usa `globalThis.fetch`.

## Reintentos, concurrencia y cancelación

```ts
import {
  uploadFile,
  DEFAULT_RETRY_POLICY,
} from '@juanoecr/stateful-chunking-upload-client';

const controller = new AbortController();

await uploadFile({
  /* ...deps... */
  concurrency: 4,                 // chunks en paralelo (default 3)
  signal: controller.signal,      // controller.abort() → CancelledError + purga en backend
  retryPolicy: {                  // default DEFAULT_RETRY_POLICY
    ...DEFAULT_RETRY_POLICY,
    maxRetries: 5,
  },
});
```

- **Reintentos:** solo se reintentan fallos **transitorios** (red, timeout, 5xx, 429). Los permanentes (404, 403, 413, 422, 409, 400) no se reintentan. Un 429 con `Retry-After` respeta esa espera; si no, cae al backoff exponencial.
- **Reanudación:** vuelve a llamar `uploadFile` con el **mismo archivo**; el backend, idempotente por *fingerprint*, devuelve la sesión existente y el SDK sube solo los chunks pendientes (evento `SessionResumed`).
- **Cancelación:** `controller.abort()` detiene lo que está en vuelo, invoca `DELETE /cancel` (best-effort) y lanza `CancelledError`.
- **Expiración:** ante una sesión expirada, el SDK inicia una nueva **una sola vez** (evento `SessionExpired`) en lugar de reintentar a ciegas.

## Progreso y eventos

`onProgress.report(uploadedBytes, totalBytes)` se llama tras cada chunk confirmado. Para telemetría fina, observa los eventos de dominio con `onEvent`:

| Evento | Campos | Cuándo |
|--------|--------|--------|
| `ChunkUploaded` | `index` | Un chunk se confirmó |
| `ChunkFailed` | `index`, `attempt`, `willRetry`, `cause` | Un intento de chunk falló (`cause` nunca incluye el token ni bytes) |
| `SessionResumed` | `sessionId`, `pending` | Se reanudó una sesión con chunks pendientes |
| `SessionExpired` | `sessionId` | Sesión expirada, antes de reiniciar |
| `UploadCompleted` | `verified` | Subida completada |
| `UploadFailed` | `cause` | La subida falló |

## Manejo de errores

Todo error lanzado extiende `UploadError` y expone un `code` legible por máquina:

```ts
import { UploadError, IntegrityError } from '@juanoecr/stateful-chunking-upload-client';

try {
  await uploadFile(/* ... */);
} catch (e) {
  if (e instanceof IntegrityError) {
    // fallo de hash: fail-closed
  } else if (e instanceof UploadError) {
    console.error(e.code, e.message);
  }
}
```

| Clase | `code` | Motivo |
|-------|--------|--------|
| `ChunkSizeValidationError` | `ERR_CHUNK_SIZE_INVALID` | `chunkSize` no entero positivo o no múltiplo de 256 KB |
| `ChunkSizeMismatchError` | `ERR_CHUNK_SIZE_MISMATCH` | Probable desajuste de `chunkSize` con el backend |
| `EmptyFileError` | `ERR_EMPTY_FILE` | Archivo vacío |
| `InvalidFileNameError` | `ERR_INVALID_FILE_NAME` | `fileName` con forma inválida |
| `IntegrityError` | `ERR_INTEGRITY` | Fallo de integridad SHA-256 (fail-closed) |
| `CryptoUnavailableError` | `ERR_CRYPTO_UNAVAILABLE` | `crypto.subtle` no disponible (contexto no seguro) |
| `TransportUnavailableError` | `ERR_TRANSPORT_UNAVAILABLE` | Sin `fetch` global ni `transport` inyectado |
| `InsecureTransportError` | `ERR_INSECURE_TRANSPORT` | `baseUrl` con esquema inseguro (ver *Seguridad de transporte*) |
| `InvalidConcurrencyError` | `ERR_INVALID_CONCURRENCY` | `concurrency` no entero ≥ 1 |
| `CancelledError` | `ERR_CANCELLED` | Cancelado vía `AbortSignal` |
| `SessionExpiredError` | `ERR_SESSION_EXPIRED` | Sesión inexistente o expirada |
| `SessionNotResumableError` | `ERR_SESSION_NOT_RESUMABLE` | Sesión no reanudable tras reiniciar |
| `RetryExhaustedError` | `ERR_RETRY_EXHAUSTED` | Reintentos agotados para un chunk (incluye `chunkIndex`) |
| `UploadHttpError` | `ERR_HTTP` | Fallo HTTP sin mapeo específico (incluye `status`, y `retryAfterMs` en 429) |

## Seguridad de transporte

El SDK rechaza *fail-fast* cualquier `baseUrl` insegura antes de tocar la red: se permite `https:` siempre y `http:` **solo** contra loopback (`localhost` / `127.0.0.1` / `[::1]`). Cualquier otro `http:` lanza `InsecureTransportError` — sin escape hatch — para no filtrar bytes ni el `upload_token` en claro.

## API

### `uploadFile(deps: UploadFileDeps): Promise<CompletionResult>`

**`UploadFileDeps`**

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|:--------:|---------|-------------|
| `baseUrl` | `string \| URL` | ✅ | — | URL base del backend, incluido su prefijo (p. ej. `.../api/chunks`) |
| `source` | `ByteSource` | ✅ | — | Fuente de bytes troceable (`BlobByteSource` / `NodeByteSource`) |
| `hasher` | `Hasher` | ✅ | — | Hasher SHA-256 (`new WebCryptoHasher()`) |
| `fileName` | `string` | ✅ | — | Nombre del archivo (validado estructuralmente) |
| `totalHash` | `string` | ✅ | — | SHA-256 hex del archivo completo (lo aporta el consumidor) |
| `transport` | `Transport` | — | `globalThis.fetch` | Función compatible con `fetch` (aquí va la auth) |
| `chunkSize` | `number` | — | `2097152` (2 MiB) | Bytes por chunk; debe coincidir con el backend |
| `onProgress` | `ProgressReporter` | — | — | `report(uploadedBytes, totalBytes)` tras cada chunk |
| `onEvent` | `(e: DomainEvent) => void` | — | — | Observador de eventos de dominio |
| `signal` | `AbortSignal` | — | — | Cancelación cooperativa |
| `concurrency` | `number` | — | `3` | Chunks en paralelo (entero ≥ 1) |
| `retryPolicy` | `RetryPolicy` | — | `DEFAULT_RETRY_POLICY` | Política de reintentos |

**`CompletionResult`**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `sessionId` | `string` | Id de la sesión de subida |
| `uploadToken` | `string` | Token de staging devuelto por el backend (no persistido por el SDK) |
| `fileName` | `string` | Nombre del archivo |
| `fileSize` | `number` | Tamaño en bytes |
| `computedHash` | `string` | SHA-256 recalculado por el backend |
| `verified` | `boolean` | `true` si la integridad quedó confirmada |

**`RetryPolicy`** (default `DEFAULT_RETRY_POLICY`)

| Campo | Default | Descripción |
|-------|---------|-------------|
| `maxRetries` | `3` | Reintentos máximos por chunk |
| `baseDelayMs` | `300` | Retardo base del backoff |
| `factor` | `2` | Factor exponencial |
| `maxDelayMs` | `15000` | Tope del retardo |
| `jitter` | `'full'` | `'full'` o `'none'` |

### Exports

- **Función:** `uploadFile`
- **Adaptadores:** `WebCryptoHasher`, `BlobByteSource` (raíz) · `NodeByteSource` (subpath `/node`)
- **Valores:** `DEFAULT_RETRY_POLICY`
- **Errores:** `UploadError` (base) y las 14 subclases de la tabla anterior
- **Tipos:** `UploadFileDeps`, `CompletionResult`, `Transport`, `ByteSource`, `Hasher`, `RetryPolicy`, `ProgressReporter`, `DomainEvent`, `RemoteStatus`

## Compatibilidad

- **Runtimes:** navegador moderno · Node ≥ 20.
- **Módulos:** ESM y CommonJS, con tipos para ambos (`import` y `require`).
- **Subpath exports:** `.` (núcleo browser-safe) y `./node` (adaptador `NodeByteSource`, que importa `node:fs`).
- **Dependencias de runtime:** ninguna.

## Contrato del backend

El SDK es fiel al contrato de los 5 endpoints del backend (`initiate`, `upload`, `status`, `complete`, `cancel`) y verifica esa fidelidad contra *contract snapshots* vendorizados en los tests. Un cambio de contrato en el backend se detecta en CI en lugar de romper al cliente en silencio.

## Licencia

[MIT](./LICENSE) © Juan Guerrero

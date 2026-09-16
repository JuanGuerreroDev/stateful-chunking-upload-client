# Ciclo de vida y resiliencia

Cómo se comporta el SDK ante fallos, interrupciones y cancelaciones, y cómo observarlo desde tu app.

## Progreso mediante eventos

Hay dos canales complementarios:

- `onProgress.report(uploadedBytes, totalBytes)` — progreso agregado tras cada chunk confirmado. Ideal para una barra de progreso.
- `onEvent(event)` — eventos de dominio para telemetría fina.

```ts
await uploadFile({
  /* ... */
  onProgress: { report: (up, total) => setPct(Math.round((up / total) * 100)) },
  onEvent: (e) => {
    switch (e.type) {
      case 'ChunkUploaded':  break;                       // e.index
      case 'ChunkFailed':    logRetry(e.index, e.attempt, e.willRetry); break;
      case 'SessionResumed': toast(`Reanudando: faltan ${e.pending}`); break;
      case 'SessionExpired': toast('Sesión expirada, reiniciando'); break;
      case 'UploadCompleted': break;                      // e.verified
      case 'UploadFailed':   break;                       // e.cause
    }
  },
});
```

`ChunkFailed.cause` nunca incluye el `upload_token` ni bytes del archivo.

## Reintentos

Cada chunk se reintenta de forma independiente ante fallos **transitorios**. La clasificación es:

| Categoría | Se reintenta | Ejemplos |
|-----------|:-----------:|----------|
| Transitorio | Sí | Error de red, timeout, 5xx, 429 |
| Permanente | No | 400, 403, 404, 409, 413, 422 |

La política por defecto es `DEFAULT_RETRY_POLICY`:

```ts
{ maxRetries: 3, baseDelayMs: 300, factor: 2, maxDelayMs: 15000, jitter: 'full' }
```

El retardo crece exponencialmente (`baseDelayMs * factor^intento`), con tope `maxDelayMs` y *jitter* completo para evitar tormentas de reintentos sincronizados. Si una respuesta 429 trae `Retry-After`, se respeta esa espera en lugar del backoff.

Personaliza extendiendo el default:

```ts
import { DEFAULT_RETRY_POLICY } from '@juanoecr/stateful-chunking-upload-client';

await uploadFile({ /* ... */, retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 5 } });
```

Si un chunk agota sus reintentos, `uploadFile` rechaza con `RetryExhaustedError`, que incluye `chunkIndex` y la causa raíz.

## Reanudación

El backend es idempotente por *fingerprint*: reconoce una subida del mismo archivo y devuelve la sesión existente con sus `pending_chunks`. El SDK sube entonces **solo** los chunks pendientes y emite `SessionResumed`.

El fingerprint se deriva de `fileName + fileSize + totalHash`. Para que una subida reanude en vez de empezar de cero, esos tres valores deben ser idénticos a los de la subida original.

```ts
async function subirConReanudacion(deps: UploadFileDeps) {
  try {
    return await uploadFile(deps);
  } catch (e) {
    if (e instanceof CancelledError) throw e; // cancelación explícita: no reintentar
    // Reintento a nivel de sesión: mismos fileName/fileSize/totalHash → reanuda pendientes.
    return await uploadFile(deps);
  }
}
```

No hay *rebind* silencioso: si la sesión no es reanudable (completada, cancelada o expirada), el SDK inicia una nueva una sola vez; si tampoco esa es viable, lanza `SessionNotResumableError`.

## Cancelación

Pasa un `AbortSignal`. Al abortar, el SDK detiene lo que está en vuelo, invoca `DELETE /cancel` en el backend (best-effort, para liberar el staging) y rechaza con `CancelledError`.

```ts
const controller = new AbortController();
document.querySelector('#cancelar')?.addEventListener('click', () => controller.abort());

try {
  await uploadFile({ /* ... */, signal: controller.signal });
} catch (e) {
  if (e instanceof CancelledError) {
    // Cancelación limpia; no la trates como fallo.
  }
}
```

La purga en el backend es best-effort: si esa llamada falla, no enmascara la `CancelledError` original.

## Expiración (TTL)

Las sesiones del backend tienen un TTL. Si el SDK detecta una sesión expirada durante la subida, emite `SessionExpired` e inicia una nueva **una sola vez**, en lugar de reintentar a ciegas contra una sesión muerta. Si la subida ya no puede completarse, la operación termina con `SessionExpiredError`.

## Concurrencia

Por defecto se suben 3 chunks en paralelo (`concurrency: 3`). Ajusta según el ancho de banda y los límites del backend; debe ser un entero ≥ 1 o el SDK lanza `InvalidConcurrencyError`.

```ts
await uploadFile({ /* ... */, concurrency: 6 });
```

Subir la concurrencia acelera en redes rápidas pero aumenta la carga sobre el backend y el riesgo de 429; en ese caso los reintentos con `Retry-After` amortiguan, pero conviene no exagerar.

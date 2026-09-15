# Contract snapshots (vendorizados del backend)

Fixtures del **contrato HTTP** del backend `juanoecr/stateful-chunking-upload`
(paquete Laravel). Los adaptadores de **B2** (`Transport` HTTP + parseo de
respuestas) se prueban contra estos archivos para garantizar fidelidad de
contrato (guardrail ARC-03, decisión **D009**).

## Procedencia

- **Fuente:** paquete backend `juanoecr/stateful-chunking-upload` (MIT).
- **Derivados de** (código, no de un servidor en vivo):
  - `Infrastructure/Http/Responses/ChunkingResponse.php` — sobres de éxito y allowlist pública.
  - `Domain/Entities/ChunkSession.php` — tipos de cada campo.
  - `Domain/Exceptions/*.php` — códigos HTTP y mensajes públicos de error.
  - `Infrastructure/Http/Controllers/ChunkUploadController.php` — errores de forma de entrada (422/413).
- **Fecha de captura:** 2026-09-15.
- **Nota de honestidad:** son snapshots **derivados de la forma del código fuente**,
  no capturas de un servidor corriendo. Antes de cerrar B2 conviene re-verificarlos
  contra los *feature tests* del backend o una respuesta real, y regenerarlos si el
  contrato cambia.

## Formato

Cada archivo describe una respuesta HTTP completa: `{ "status": <int>, "body": <json> }`.
`status` es el código HTTP (importa: `initiate` es **201**, el resto **200**);
`body` es el JSON exacto que el SDK debe saber parsear.

| Archivo | Endpoint | Status |
|---------|----------|--------|
| `initiate.json` | POST /initiate | 201 |
| `upload.json` | POST /upload (chunk 0) | 200 |
| `status.uploading.json` | GET /status (parcial) | 200 |
| `status.completed.json` | GET /status (completa) | 200 |
| `status.expired.json` | GET /status (expirada, borde) | 200 |
| `complete.json` | POST /complete | 200 |
| `cancel.json` | DELETE /cancel | 200 |
| `errors.json` | mapa de todos los errores del dominio | varios |

## Hechos de contrato a respetar en B2

1. **`owner_id` nunca se expone** — la allowlist pública lo omite deliberadamente
   (anti-IDOR/PII). El SDK no debe esperarlo ni depender de él.
2. **`fingerprint` es del cliente y se devuelve verbatim** — el backend lo almacena
   tal cual lo envía el SDK. `deriveFingerprint(fileName, fileSize, totalHash)` del
   SDK es la fuente del valor; el servidor solo lo round-trip-ea. Debe ser **por
   archivo** (nombre+tamaño+hash), nunca por usuario/lote.
3. **`chunks_map` es un array posicional**, no un objeto: `["completed","pending",...]`
   indexado por posición de chunk (PHP serializa claves enteras secuenciales como array).
4. **La expiración es un booleano derivado**, no un `status`. `is_expired`/`remaining_ttl`
   son campos aparte; `status` mantiene el enum (`pending|uploading|completed|failed|cancelled`).
   Tras purga, el backend responde 404 `SessionNotFoundException`, no un status "expired".
5. **Timestamps** (`created_at`, `expires_at`) son **enteros unix en segundos**.
6. **Sobre de error uniforme:** `{ "message": "<mensaje público>" }` en el `status`
   correspondiente. Los mensajes son genéricos por diseño (nunca filtran internals).
7. **`/status` no lleva `message`** (solo `data`); el resto de éxitos sí.
8. **`/cancel` no lleva `data`** (solo `message`).
9. **429 a nivel de middleware:** las rutas están tras el middleware `throttle`
   (activo por defecto en `routes/api.php`), así que el backend **sí puede emitir
   `429 Too Many Requests`** por límite de tasa — no es una `ChunkingException` del
   dominio (por eso no aparece en `errors.json`). El SDK lo mapea a `UploadHttpError`
   (status 429) en B2; la política de reintento con `Retry-After` vive en B3
   (ver `classifyError`, que ya clasifica 429 como transitorio).

import type { Transport } from '../../ports/transport';
import type { RemoteSnapshot, RemoteStatus } from '../../domain/upload-session';
import { assertSecureBaseUrl } from '../../domain/secure-url';
import {
  IntegrityError,
  SessionExpiredError,
  UploadError,
  UploadHttpError,
} from '../../errors';

/** Resultado de `/complete` (`fileReassembled`). Ver `complete.json`. */
export interface CompletionResult {
  sessionId: string;
  uploadToken: string;
  fileName: string;
  fileSize: number;
  computedHash: string;
  verified: boolean;
}

/** Cuerpo de una petición de subida de chunk (US-01). */
export interface ChunkUploadRequest {
  sessionId: string;
  chunkIndex: number;
  chunkHash: string;
  bytes: Uint8Array;
}

/** Cuerpo de una petición de inicio de sesión (US-01). */
export interface InitiateRequest {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  totalHash: string;
  fingerprint: string;
}

/** Envelope uniforme del backend: `{ message, data }` (ADR-0002 del backend). */
interface Envelope<T> {
  message?: string;
  data?: T;
}

/** Proyección pública de la sesión (allowlist `publicSessionData` del backend). */
interface SessionData {
  session_id: string;
  status: RemoteStatus;
  pending_chunks: number[];
  uploaded_bytes: number;
  is_expired: boolean;
  remaining_ttl: number;
}

/** Resultado de `/initiate`: el `session_id` recién asignado + el snapshot inicial. */
export interface InitiateResult {
  sessionId: string;
  snapshot: RemoteSnapshot;
}

interface CompletionData {
  session_id: string;
  upload_token: string;
  file_name: string;
  file_size: number;
  computed_hash: string;
  verified: boolean;
}

/**
 * Cliente HTTP del contrato de chunking (US-01/06, ADR-B2-03/04/07).
 *
 * Traduce entre el dominio del SDK y el contrato HTTP del backend: construye las
 * peticiones (JSON en `/initiate` y `/complete`, `multipart/form-data` en
 * `/upload`), parsea el envelope `{ message, data }` a tipos de dominio y mapea
 * los códigos de estado a errores tipados. No conoce autenticación (SEC-06): eso
 * vive en el `Transport` inyectado.
 */
export class ChunkHttpClient {
  private readonly base: string;

  constructor(
    baseUrl: string | URL,
    private readonly transport: Transport,
  ) {
    // Enforcement de esquema seguro (SEC-01, defensa en profundidad): nadie construye
    // el cliente con un `baseUrl` inseguro, aunque se saltase la validación del borde.
    assertSecureBaseUrl(baseUrl);
    // Normaliza a string sin barra final para unir rutas de forma predecible.
    this.base = (typeof baseUrl === 'string' ? baseUrl : baseUrl.toString()).replace(/\/+$/, '');
  }

  async initiate(request: InitiateRequest, signal?: AbortSignal): Promise<InitiateResult> {
    const response = await this.transport(this.url('/initiate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        file_name: request.fileName,
        file_size: request.fileSize,
        total_chunks: request.totalChunks,
        total_hash: request.totalHash,
        fingerprint: request.fingerprint,
      }),
      signal,
    });
    const data = await this.readData<SessionData>(response);
    return { sessionId: data.session_id, snapshot: toSnapshot(data) };
  }

  async uploadChunk(request: ChunkUploadRequest, signal?: AbortSignal): Promise<RemoteSnapshot> {
    const form = new FormData();
    form.append('session_id', request.sessionId);
    form.append('chunk_index', String(request.chunkIndex));
    form.append('chunk_hash', request.chunkHash);
    // Un nombre de archivo hace que el backend lo trate como fichero subido
    // ($request->file('file')). El contenido real es opaco; el nombre no importa.
    // Copia a un ArrayBuffer propio para no exponer el buffer subyacente del Uint8Array.
    const bytes = request.bytes.slice();
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'chunk');

    // NOTA: no fijamos content-type; fetch añade el boundary de multipart.
    const response = await this.transport(this.url('/upload'), {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: form,
      signal,
    });
    return toSnapshot(await this.readData<SessionData>(response));
  }

  async complete(sessionId: string, signal?: AbortSignal): Promise<CompletionResult> {
    const response = await this.transport(this.url('/complete'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    });
    const data = await this.readData<CompletionData>(response);
    return {
      sessionId: data.session_id,
      uploadToken: data.upload_token,
      fileName: data.file_name,
      fileSize: data.file_size,
      computedHash: data.computed_hash,
      verified: data.verified,
    };
  }

  /**
   * Consulta el estado de una sesión (US-03/08). Ruta con **path param** UUID
   * (`GET /status/{sessionId}`); un id malformado no matchea la ruta → 404 →
   * `SessionExpiredError`. Respalda el método público `status()` y el re-chequeo
   * de expiración (ADR-B3-05).
   */
  async status(sessionId: string, signal?: AbortSignal): Promise<RemoteSnapshot> {
    const response = await this.transport(this.url(`/status/${encodeURIComponent(sessionId)}`), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal,
    });
    return toSnapshot(await this.readData<SessionData>(response));
  }

  /**
   * Cancela y purga una sesión (US-04). `DELETE /cancel/{sessionId}`; el backend
   * responde `{ message }` **sin `data`**, así que no usamos `readData`. Es
   * *best-effort*: no lanza ante una respuesta no-OK (el fail-safe de la cancelación
   * lo maneja `uploadFile`); un fallo de red del propio `fetch` sí se propaga y lo
   * atrapa el `safeCancel` del llamador.
   */
  async cancel(sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.transport(this.url(`/cancel/${encodeURIComponent(sessionId)}`), {
      method: 'DELETE',
      headers: { accept: 'application/json' },
      signal,
    });
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  /** Lee el envelope de una respuesta OK o lanza el error tipado si no lo es. */
  private async readData<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await this.toError(response);
    }
    const envelope = (await response.json()) as Envelope<T>;
    if (envelope.data === undefined) {
      throw new UploadHttpError(
        response.status,
        'Respuesta del backend sin campo `data` (contrato inesperado).',
      );
    }
    return envelope.data;
  }

  /** Mapea un status HTTP a un error tipado (ADR-B2-07/ADR-B3-01; `logical_design.md` §7). */
  private async toError(response: Response): Promise<UploadError> {
    const message = await this.readMessage(response);
    switch (response.status) {
      case 404:
        // Sesión inexistente/purgada/expirada — no transitorio (US-08 AC-1).
        return new SessionExpiredError(message);
      case 422:
        // Fallo de integridad de chunk — fail-closed (US-02). Los otros 422 del
        // backend (índice fuera de rango, chunk vacío) son inalcanzables por el
        // SDK, que controla chunk_index y nunca envía chunks vacíos.
        return new IntegrityError(message);
      default:
        // 429/5xx (transitorios, reintento en B3) y 4xx sin mapeo específico. El
        // `Retry-After` del 429 viaja en el error para que `decideRetry` lo respete.
        return new UploadHttpError(
          response.status,
          message,
          undefined,
          parseRetryAfter(response.headers.get('retry-after')),
        );
    }
  }

  /** Extrae `message` del envelope de error sin romper si el cuerpo no es JSON. */
  private async readMessage(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as Envelope<unknown>;
      if (typeof body.message === 'string' && body.message.length > 0) {
        return body.message;
      }
    } catch {
      // Cuerpo no-JSON o vacío: caemos al mensaje genérico por status.
    }
    return `La petición falló con estado HTTP ${response.status}.`;
  }
}

/**
 * Parsea la cabecera `Retry-After` (US-07 AC-5) a milisegundos. Acepta ambas formas
 * del estándar: delta-seconds (entero) o HTTP-date. Devuelve `undefined` si falta o
 * es inválida → `decideRetry` cae al backoff exponencial.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/** SessionData del contrato → `RemoteSnapshot` del dominio (solo campos de la allowlist). */
function toSnapshot(data: SessionData): RemoteSnapshot {
  return {
    status: data.status,
    pending_chunks: data.pending_chunks,
    uploaded_bytes: data.uploaded_bytes,
    is_expired: data.is_expired,
    remaining_ttl: data.remaining_ttl,
  };
}

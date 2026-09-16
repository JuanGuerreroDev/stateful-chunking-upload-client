import { InvalidConcurrencyError } from '../errors';

/**
 * Pool de *workers* acotado (RES-03 / NFR-06, D014.2). Reparte los índices entre
 * `concurrency` runners que consumen una cola compartida (orden ascendente). A lo
 * sumo `concurrency` operaciones en vuelo → pico de memoria O(chunkSize × concurrency)
 * y sin DoS involuntario (R-06).
 *
 * Cancelación y fail-fast: un `AbortController` interno se **encadena** al `signal`
 * externo. Ante el primer error de cualquier runner, se aborta el resto (los `fetch`
 * y backoffs en vuelo de los hermanos se cancelan); se guarda `firstError` para
 * propagar la **causa raíz** y no el `AbortError` secundario de los hermanos.
 *
 * El `worker` recibe la señal encadenada: debe usarla para sus peticiones y esperas,
 * de modo que un aborto (externo o por fallo hermano) lo detenga limpiamente.
 */
export async function concurrencyPool(
  indices: readonly number[],
  concurrency: number,
  worker: (index: number, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new InvalidConcurrencyError(
      `concurrency debe ser un entero >= 1; recibido: ${String(concurrency)}.`,
    );
  }
  if (indices.length === 0) return;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let cursor = 0;
  let firstError: unknown;
  let failed = false;

  const fail = (error: unknown): void => {
    if (!failed) {
      failed = true;
      firstError = error;
      controller.abort(error);
    }
  };

  const runOne = async (): Promise<void> => {
    while (cursor < indices.length && !controller.signal.aborted) {
      const index = indices[cursor++]!;
      try {
        await worker(index, controller.signal);
      } catch (error) {
        fail(error);
        return;
      }
    }
  };

  const runnerCount = Math.min(concurrency, indices.length);
  try {
    await Promise.all(Array.from({ length: runnerCount }, () => runOne()));
  } finally {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  if (failed) throw firstError;
}

import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/application/with-retry';
import type { RetryPolicy } from '../../src/domain/retry';
import { SessionExpiredError, UploadHttpError } from '../../src/errors';

const FAST: RetryPolicy = { maxRetries: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 4, jitter: 'none' };

describe('withRetry — reintentos con backoff (US-07)', () => {
  it('no reintenta si la operación tiene éxito a la primera', async () => {
    const op = vi.fn(async () => 'ok');
    await expect(withRetry(op, { policy: FAST })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('reintenta un error transitorio (5xx) y luego tiene éxito', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new UploadHttpError(500, 'boom'))
      .mockResolvedValueOnce('ok');
    const onAttemptFailed = vi.fn();

    await expect(withRetry(op, { policy: FAST, onAttemptFailed })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(onAttemptFailed).toHaveBeenCalledTimes(1);
    expect(onAttemptFailed.mock.calls[0]![0]).toMatchObject({ attempt: 0, willRetry: true });
  });

  it('reintenta un error de red (TypeError de fetch)', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(op, { policy: FAST })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('reintenta un timeout (DOMException TimeoutError)', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(op, { policy: FAST })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta un error permanente (4xx de validación)', async () => {
    const op = vi.fn(async () => {
      throw new UploadHttpError(413, 'too big');
    });
    await expect(withRetry(op, { policy: FAST })).rejects.toBeInstanceOf(UploadHttpError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('NO reintenta SessionExpiredError (no es transitorio, US-08 AC-4)', async () => {
    const op = vi.fn(async () => {
      throw new SessionExpiredError('expirada');
    });
    await expect(withRetry(op, { policy: FAST })).rejects.toBeInstanceOf(SessionExpiredError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('agota los reintentos: maxRetries + 1 intentos y relanza la causa', async () => {
    const op = vi.fn(async () => {
      throw new UploadHttpError(500, 'server');
    });
    await expect(withRetry(op, { policy: FAST })).rejects.toBeInstanceOf(UploadHttpError);
    expect(op).toHaveBeenCalledTimes(FAST.maxRetries + 1); // 4
  });

  it('respeta Retry-After sobre el backoff exponencial (US-07 AC-5)', async () => {
    const slow: RetryPolicy = { ...FAST, baseDelayMs: 1000 };
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new UploadHttpError(429, 'rate', undefined, 20))
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await expect(withRetry(op, { policy: slow })).resolves.toBe('ok');
    const elapsed = Date.now() - start;

    expect(op).toHaveBeenCalledTimes(2);
    // Si respetó Retry-After (~20ms) y no el backoff (1000ms), el tiempo es pequeño.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('withRetry — cancelación', () => {
  it('lanza sin invocar la operación si el signal ya está abortado', async () => {
    const controller = new AbortController();
    controller.abort();
    const op = vi.fn(async () => 'ok');
    await expect(withRetry(op, { policy: FAST, signal: controller.signal })).rejects.toThrow();
    expect(op).not.toHaveBeenCalled();
  });

  it('aborta la espera de backoff cuando se cancela durante el retraso', async () => {
    const controller = new AbortController();
    const op = vi.fn(async () => {
      controller.abort(); // cancela justo antes de programar el backoff
      throw new UploadHttpError(500, 'server');
    });
    await expect(
      withRetry(op, { policy: FAST, signal: controller.signal }),
    ).rejects.toBeInstanceOf(DOMException);
    expect(op).toHaveBeenCalledTimes(1);
  });
});

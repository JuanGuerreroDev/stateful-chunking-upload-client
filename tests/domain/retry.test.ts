import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  classifyError,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from '../../src/domain/retry';

describe('classifyError (US-07 — fidelidad de contrato ARC-03)', () => {
  it('sin respuesta del servidor (red/timeout) → transient', () => {
    expect(classifyError({ isNetworkError: true })).toBe('transient');
    expect(classifyError({ isTimeout: true })).toBe('transient');
  });

  it('5xx (500 StorageFailure, 503) y 429 → transient', () => {
    expect(classifyError({ status: 500 })).toBe('transient');
    expect(classifyError({ status: 503 })).toBe('transient');
    expect(classifyError({ status: 429 })).toBe('transient');
  });

  it('4xx del contrato (404/403/409/413/422/400) → permanent', () => {
    for (const status of [400, 403, 404, 409, 413, 422]) {
      expect(classifyError({ status })).toBe('permanent');
    }
  });

  it('fallo desconocido (sin status ni bandera de red) → permanent (conservador)', () => {
    expect(classifyError({})).toBe('permanent');
  });
});

describe('decideRetry (US-07)', () => {
  afterEach(() => vi.restoreAllMocks());

  const NO_JITTER: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitter: 'none' };

  it('un fallo permanente nunca se reintenta', () => {
    expect(decideRetry({ status: 404 }, 0, NO_JITTER)).toEqual({ retry: false, delayMs: 0 });
  });

  it('deja de reintentar al alcanzar maxRetries', () => {
    const verdict = decideRetry({ status: 500 }, NO_JITTER.maxRetries, NO_JITTER);
    expect(verdict).toEqual({ retry: false, delayMs: 0 });
  });

  it('backoff exponencial: base * factor^attempt (sin jitter)', () => {
    expect(decideRetry({ status: 500 }, 0, NO_JITTER).delayMs).toBe(300);
    expect(decideRetry({ status: 500 }, 1, NO_JITTER).delayMs).toBe(600);
    expect(decideRetry({ status: 500 }, 2, NO_JITTER).delayMs).toBe(1200);
  });

  it('el backoff se limita a maxDelayMs', () => {
    const policy: RetryPolicy = { ...NO_JITTER, maxRetries: 100, maxDelayMs: 1000 };
    expect(decideRetry({ status: 500 }, 10, policy).delayMs).toBe(1000);
  });

  it('AC-5: respeta Retry-After por encima del backoff calculado', () => {
    const verdict = decideRetry({ status: 429 }, 0, NO_JITTER, 5000);
    expect(verdict).toEqual({ retry: true, delayMs: 5000 });
  });

  it("jitter 'full' mantiene el delay dentro de [0, capped]", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // attempt 1: capped = 600; con random=0.5 → 300
    expect(decideRetry({ status: 500 }, 1, DEFAULT_RETRY_POLICY).delayMs).toBe(300);
  });
});

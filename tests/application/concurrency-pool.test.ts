import { describe, it, expect } from 'vitest';
import { concurrencyPool } from '../../src/application/concurrency-pool';
import { InvalidConcurrencyError } from '../../src/errors';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('concurrencyPool — pool de workers acotado (RES-03/NFR-06)', () => {
  it('procesa todos los índices', async () => {
    const seen: number[] = [];
    await concurrencyPool([0, 1, 2, 3, 4], 2, async (index) => {
      seen.push(index);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('nunca supera el límite de concurrencia', async () => {
    let active = 0;
    let maxActive = 0;
    await concurrencyPool([0, 1, 2, 3, 4, 5], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(5);
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('es un no-op con una lista vacía', async () => {
    let called = 0;
    await concurrencyPool([], 3, async () => {
      called++;
    });
    expect(called).toBe(0);
  });

  it('rechaza una concurrencia inválida (fail-fast, COD-03)', async () => {
    await expect(concurrencyPool([0], 0, async () => {})).rejects.toBeInstanceOf(
      InvalidConcurrencyError,
    );
    await expect(concurrencyPool([0], 1.5, async () => {})).rejects.toBeInstanceOf(
      InvalidConcurrencyError,
    );
  });

  it('fail-fast: al primer error propaga la causa raíz y deja de tomar índices', async () => {
    const processed: number[] = [];
    const boom = new Error('chunk 2 falló');
    await expect(
      concurrencyPool(
        [0, 1, 2, 3, 4],
        1, // secuencial para determinismo
        async (index) => {
          processed.push(index);
          if (index === 2) throw boom;
        },
      ),
    ).rejects.toBe(boom);
    // Con concurrencia 1, tras fallar en el índice 2 no se procesan 3 ni 4.
    expect(processed).toEqual([0, 1, 2]);
  });

  it('un aborto externo detiene la toma de nuevos índices', async () => {
    const controller = new AbortController();
    const processed: number[] = [];
    await concurrencyPool(
      [0, 1, 2, 3, 4],
      1,
      async (index) => {
        processed.push(index);
        if (index === 1) controller.abort();
      },
      controller.signal,
    );
    // Tras abortar en el índice 1, no se toman más índices.
    expect(processed).toEqual([0, 1]);
  });
});

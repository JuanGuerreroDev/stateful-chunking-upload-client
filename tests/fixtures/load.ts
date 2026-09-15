import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Snapshot vendorizado del contrato: `{ status, body }`. */
export interface ContractSnapshot {
  status: number;
  body: unknown;
}

/** Carga un fixture de `tests/fixtures/contract/`. */
export function loadFixture(name: string): ContractSnapshot {
  return JSON.parse(readFileSync(join(here, 'contract', name), 'utf-8')) as ContractSnapshot;
}

/** Construye una `Response` HTTP a partir de un snapshot (para dobles de `Transport`). */
export function fixtureResponse(name: string): Response {
  const { status, body } = loadFixture(name);
  return jsonResponse(status, body);
}

/** `Response` JSON arbitraria. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface ErrorScenario {
  status: number;
  body: { message: string };
  _classification: 'transient' | 'permanent';
}

/** Escenarios de error del backend (`errors.json`), con sus claves conocidas. */
export interface ErrorScenarios {
  session_not_found: ErrorScenario;
  unauthorized: ErrorScenario;
  session_not_ready: ErrorScenario;
  budget_exceeded: ErrorScenario;
  chunk_index_out_of_bounds: ErrorScenario;
  chunk_integrity: ErrorScenario;
  input_empty: ErrorScenario;
  input_too_large: ErrorScenario;
  storage_failure: ErrorScenario;
  generic: ErrorScenario;
}

export function loadErrorScenarios(): ErrorScenarios {
  return JSON.parse(readFileSync(join(here, 'contract', 'errors.json'), 'utf-8')) as ErrorScenarios;
}

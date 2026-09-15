/**
 * Entry point para Node (`@juanoecr/stateful-chunking-upload-client/node`).
 *
 * Aislado del entry principal porque importa `node:fs` (ADR-B2-02): un bundler de
 * navegador que use el paquete principal nunca resuelve este módulo. Úsalo en
 * Node para subir un archivo del sistema de archivos con `NodeByteSource`.
 */
export { NodeByteSource } from './adapters/node-byte-source';

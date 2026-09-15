/**
 * Puerto de transporte (ARC-01/02, US-06).
 *
 * Deliberadamente idéntico a la firma de `fetch`: cualquier `fetch` global, un
 * polyfill, o una envoltura del consumidor que añada autenticación encaja sin
 * adaptador. El SDK **no** conoce ni añade cabeceras de auth (SEC-06).
 */
export type Transport = (input: string | URL, init?: RequestInit) => Promise<Response>;

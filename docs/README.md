# Guías de integración

Documentación para integrar `@juanoecr/stateful-chunking-upload-client` en un sistema consumidor (navegador o Node). Para la referencia rápida de la API, ver el [README raíz](../README.md).

## Índice

1. [Primeros pasos](./getting-started.md) — integración end-to-end, cómo calcular `totalHash` y coincidir el `chunkSize` con el backend.
2. [Autenticación](./authentication.md) — inyectar un `transport` que añada las cabeceras de auth (el SDK no las gestiona).
3. [Ciclo de vida y resiliencia](./lifecycle-and-resiliency.md) — reintentos, reanudación, cancelación, expiración y progreso mediante eventos.
4. [Manejo de errores](./error-handling.md) — la taxonomía de errores tipados y cómo traducirla a la experiencia de usuario.

## Requisitos previos

- Un backend [`juanoecr/stateful-chunking-upload`](https://github.com/JuanGuerreroDev/stateful-chunking-upload) en ejecución y accesible.
- Node ≥ 20 o un navegador moderno.
- El `chunkSize` del cliente debe coincidir con `chunk_size_bytes` del backend (default 2 MiB).

## Modelo mental en una frase

Le das al SDK una fuente de bytes, el hash del archivo completo y la URL del backend; él trocea, sube en paralelo verificando cada chunk, y te devuelve un `CompletionResult` con el `uploadToken` de staging. La autenticación, el origen de los bytes y la persistencia del token son responsabilidad de tu aplicación.

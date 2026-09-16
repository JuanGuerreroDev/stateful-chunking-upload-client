# Primeros pasos

Esta guía integra el SDK de extremo a extremo en un sistema consumidor.

## 1. Instalar

```bash
pnpm add @juanoecr/stateful-chunking-upload-client
```

El paquete no tiene dependencias de runtime. Publica ESM y CommonJS con tipos para ambos.

## 2. Elegir la fuente de bytes

El SDK lee el archivo por rangos `[start, end)` a través del puerto `ByteSource`, sin cargarlo entero en memoria. Hay un adaptador por entorno:

| Entorno | Adaptador | Import | Construcción |
|---------|-----------|--------|--------------|
| Navegador | `BlobByteSource` | raíz del paquete | `new BlobByteSource(file)` (`File` o `Blob`) |
| Node | `NodeByteSource` | subpath `/node` | `await NodeByteSource.of(rutaAbsoluta)` |

```ts
// Navegador
import { BlobByteSource } from '@juanoecr/stateful-chunking-upload-client';
const source = new BlobByteSource(file);

// Node
import { NodeByteSource } from '@juanoecr/stateful-chunking-upload-client/node';
const source = await NodeByteSource.of('./video.mp4');
```

El subpath `/node` está separado a propósito: importa `node:fs`, así que los bundlers de navegador nunca lo resuelven.

## 3. Calcular `totalHash`

El SDK verifica integridad por chunk y de forma total, pero **no** calcula el hash del archivo completo por ti: lo aportas en `totalHash` (SHA-256 en hex). Esto evita imponerte una estrategia de hashing. Elige según el tamaño del archivo:

### Opción A — archivo completo en memoria (simple)

Reutiliza el `WebCryptoHasher` que ya exporta el SDK sobre los bytes completos. Sencillo, pero carga el archivo entero en memoria.

```ts
import { WebCryptoHasher } from '@juanoecr/stateful-chunking-upload-client';

const hasher = new WebCryptoHasher();

// Navegador
const totalHash = await hasher.sha256(new Uint8Array(await file.arrayBuffer()));

// Node
import { readFile } from 'node:fs/promises';
const totalHash = await hasher.sha256(new Uint8Array(await readFile('./video.mp4')));
```

### Opción B — streaming en Node (archivos grandes)

`crypto.subtle.digest` es *one-shot* (no incremental). En Node, para no cargar el archivo en memoria, usa `node:crypto` con un stream:

```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const totalHash = await sha256File('./video.mp4');
```

> En el navegador no hay una API nativa de hashing incremental. Para archivos muy grandes tendrías que usar una librería JS de SHA-256 por streaming (fuera del alcance de este SDK) o precomputar el hash en el servidor de origen.

El hash debe corresponder exactamente a los bytes que subes; si difiere, el backend rechazará la verificación final y el SDK lanzará `IntegrityError`.

## 4. Coincidir el `chunkSize` con el backend

El backend fija su tamaño de chunk por configuración (`chunk_size_bytes`, default 2 MiB) y no lo expone por la API. El cliente usa el mismo default (2 MiB); si tu backend lo cambió, pásalo explícito. Debe ser un entero múltiplo de 256 KB, o el SDK lanza `ChunkSizeValidationError` antes de tocar la red.

```ts
await uploadFile({ /* ... */, chunkSize: 4 * 1024 * 1024 }); // 4 MiB
```

## 5. Subir

```ts
import { uploadFile, WebCryptoHasher, BlobByteSource } from '@juanoecr/stateful-chunking-upload-client';

const hasher = new WebCryptoHasher();
const totalHash = await hasher.sha256(new Uint8Array(await file.arrayBuffer()));

const result = await uploadFile({
  baseUrl: 'https://api.example.com/api/chunks',
  source: new BlobByteSource(file),
  hasher,
  fileName: file.name,
  totalHash,
  onProgress: {
    report: (uploaded, total) => {
      const pct = Math.round((uploaded / total) * 100);
      console.log(`${pct}%`);
    },
  },
});
```

## 6. Usar el resultado

`uploadFile` resuelve con un `CompletionResult`:

```ts
if (result.verified) {
  // Persiste result.uploadToken en TU sistema para materializar/asociar el archivo.
  // El SDK no lo guarda: solo te lo devuelve.
  await miApi.registrarArchivo({ token: result.uploadToken, nombre: result.fileName });
}
```

| Campo | Uso típico |
|-------|-----------|
| `uploadToken` | Referencia de staging que tu backend usa para finalizar/asociar el archivo |
| `verified` | Confirmación de integridad extremo a extremo |
| `computedHash` | Hash recalculado por el backend (comparar/auditar) |
| `sessionId`, `fileName`, `fileSize` | Metadatos de la subida |

## Siguientes pasos

- [Autenticación](./authentication.md) para peticiones protegidas.
- [Ciclo de vida y resiliencia](./lifecycle-and-resiliency.md) para reanudación, cancelación y reintentos.
- [Manejo de errores](./error-handling.md) para una integración robusta.

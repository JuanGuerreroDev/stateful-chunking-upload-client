# Autenticación

El SDK **no** conoce ni añade cabeceras de autenticación: es una decisión de diseño deliberada (el backend confirma que la auth es responsabilidad de la aplicación anfitriona). El SDK habla con el backend a través de un puerto `Transport` con la misma firma que `fetch`:

```ts
type Transport = (input: string | URL, init?: RequestInit) => Promise<Response>;
```

Si omites `transport`, el SDK usa `globalThis.fetch` sin cabeceras extra. Para peticiones protegidas, inyecta un `transport` que envuelva `fetch` y añada lo que tu backend requiera.

## Bearer token

```ts
import type { Transport } from '@juanoecr/stateful-chunking-upload-client';

function bearerTransport(getToken: () => string): Transport {
  return (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${getToken()}` },
    });
}

await uploadFile({ /* ... */, transport: bearerTransport(() => store.accessToken) });
```

Pasar una función (`getToken()`) en vez del token literal permite que cada chunk use el token vigente si tu app lo rota durante una subida larga.

## Cookies de sesión (misma-origen o CORS con credenciales)

```ts
const cookieTransport: Transport = (input, init) =>
  fetch(input, { ...init, credentials: 'include' });
```

Requiere que el backend responda con los encabezados CORS adecuados (`Access-Control-Allow-Credentials`) si el origen difiere.

## Cabecera CSRF

```ts
const csrfTransport: Transport = (input, init) =>
  fetch(input, {
    ...init,
    credentials: 'include',
    headers: { ...init?.headers, 'X-XSRF-TOKEN': leerCookieXsrf() },
  });
```

## Refresco de token bajo demanda (401 → reintento)

Puedes interceptar respuestas dentro del propio `transport`. Ojo: el SDK ya reintenta los fallos transitorios de red/5xx; aquí solo se ilustra el refresco de credenciales, que es lógica de tu app.

```ts
function authWithRefresh(auth: AuthStore): Transport {
  return async (input, init) => {
    let res = await fetch(input, withAuth(init, auth.token));
    if (res.status === 401 && (await auth.refresh())) {
      res = await fetch(input, withAuth(init, auth.token));
    }
    return res;
  };
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } };
}
```

## Recomendaciones

- **No** incrustes tokens en la `baseUrl` ni en query params: el SDK rechaza `http:` no-loopback (`InsecureTransportError`), pero además las URLs se registran/cachean con facilidad. Usa cabeceras.
- Mantén la auth en el `transport`, no en el resto de tu código de subida: así un cambio de esquema de auth queda en un solo sitio.
- El SDK nunca registra el `upload_token` ni los bytes en sus eventos de error; evita tú también volcarlos en logs.

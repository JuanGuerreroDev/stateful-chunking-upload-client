import { describe, it, expect } from 'vitest';
import { assertSecureBaseUrl } from '../../src/domain/secure-url';
import { InsecureTransportError } from '../../src/errors';

describe('assertSecureBaseUrl — enforcement de HTTPS (SEC-01/NFR-02, D014.3)', () => {
  it('permite https: contra cualquier host', () => {
    expect(() => assertSecureBaseUrl('https://api.example.com/api/chunks')).not.toThrow();
  });

  it('permite http: solo contra loopback', () => {
    expect(() => assertSecureBaseUrl('http://localhost:8000/api/chunks')).not.toThrow();
    expect(() => assertSecureBaseUrl('http://127.0.0.1:8000/api/chunks')).not.toThrow();
    expect(() => assertSecureBaseUrl('http://[::1]:8000/api/chunks')).not.toThrow();
  });

  it('rechaza http: contra un host no-local con InsecureTransportError', () => {
    expect(() => assertSecureBaseUrl('http://api.example.com/api/chunks')).toThrow(
      InsecureTransportError,
    );
  });

  it('rechaza una URL malformada', () => {
    expect(() => assertSecureBaseUrl('no-es-una-url')).toThrow(InsecureTransportError);
  });

  it('acepta una instancia URL, no solo string', () => {
    expect(() => assertSecureBaseUrl(new URL('https://api.example.com'))).not.toThrow();
    expect(() => assertSecureBaseUrl(new URL('http://evil.example.com'))).toThrow(
      InsecureTransportError,
    );
  });
});

export function buildAuthorizationCsp(origin: string, nonce?: string): string {
  const workerOrigin = new URL(origin).origin;
  return `default-src 'none'; style-src 'unsafe-inline'; form-action ${workerOrigin} https://github.com; frame-ancestors 'none'; base-uri 'none'${nonce ? `; script-src 'nonce-${nonce}'; connect-src ${workerOrigin}` : ''}`;
}

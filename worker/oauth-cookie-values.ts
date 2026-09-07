export function cookieValue(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}


export function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = actualBytes.length ^ expectedBytes.length;
  const length = Math.max(actualBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index++) difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  return difference === 0;
}


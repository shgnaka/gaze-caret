declare namespace Cloudflare {
  interface Env {
    [key: string]: unknown;
  }
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type DurableObjectJurisdiction = string;

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Env = Cloudflare.Env> {
    protected readonly env: Env;
    protected readonly ctx: ExecutionContext;
  }
}

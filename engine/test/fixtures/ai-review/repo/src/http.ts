/**
 * Minimal HTTP surface the route handlers are written against.
 */

export interface Request {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Uint8Array;
  session: { deviceId: string } | null;
}

export interface Response {
  status(code: number): Response;
  json(payload: unknown): void;
  end(): void;
}

export type Handler = (request: Request, response: Response) => Promise<void>;

export interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
}

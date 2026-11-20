/** An error from the sales API: the HTTP status, the server's error code (if any) and a message for the person. */
export class SalesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SalesApiError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

interface ErrorBody {
  error?: unknown;
  message?: unknown;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asErrorBody(data: unknown): ErrorBody | null {
  return typeof data === 'object' && data !== null ? data : null;
}

/**
 * Calls the API and returns the parsed JSON body (null for an empty one).
 * A 401 sends the person to the sign-in page. The caller names the response type it expects;
 * the server is the source of that shape (see src/routes/sales.ts).
 */
export async function api<T>(method: HttpMethod, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = parseJson(text);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new SalesApiError('Please sign in again.', 401);
  }
  if (!res.ok) {
    const info = asErrorBody(data);
    const message = info && typeof info.message === 'string' && info.message ? info.message : 'Something went wrong. Please try again.';
    throw new SalesApiError(message, res.status, info && typeof info.error === 'string' ? info.error : undefined);
  }
  return data as T;
}

/** The message to show for anything a request can throw, or the fallback when there is none. */
export function messageOf(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message) return e.message;
  return fallback;
}

/** The HTTP status of an API failure, if the error has one. */
export function statusOf(e: unknown): number | undefined {
  return e instanceof SalesApiError ? e.status : undefined;
}

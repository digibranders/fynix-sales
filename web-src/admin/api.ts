/** A failed API call: the HTTP status, the server's error code when it sent one, and the message to show. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

function textField(data: unknown, key: string): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Calls the JSON API. A 401 sends the person back to sign in. Any other failure throws an ApiFailure.
 * The caller names the response shape it expects; the server's shapes live in src/routes/admin.ts.
 */
export async function api<T>(method: HttpMethod, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = parseJson(text);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiFailure('Please sign in again.', 401);
  }
  if (!res.ok) throw new ApiFailure(textField(data, 'message') ?? FALLBACK_MESSAGE, res.status, textField(data, 'error'));
  return data as T;
}

/** The message to show for any caught value, or the fallback when it carries none. */
export function messageOf(error: unknown, fallback: string = FALLBACK_MESSAGE): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

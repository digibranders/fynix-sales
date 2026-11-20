/** An error from the API with the message to show the person and the HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function send<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(data.message ?? 'Something went wrong. Please try again.', res.status);
  return data as T;
}

export const getJson = <T>(url: string): Promise<T> => send<T>('GET', url);
export const postJson = <T>(url: string, body?: unknown): Promise<T> => send<T>('POST', url, body);

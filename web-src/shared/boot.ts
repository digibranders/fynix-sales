/**
 * The first data for a page, embedded in the HTML by the server so the screen does not wait for a second request.
 * It can be taken once. When it is missing, or on later refreshes, the caller fetches fresh data as usual.
 */
export function takeEmbedded<T>(): T | null {
  const node = document.getElementById('boot');
  if (!node) return null;
  node.remove();
  try {
    return JSON.parse(node.textContent ?? '') as T;
  } catch {
    return null;
  }
}

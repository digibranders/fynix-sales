/** Small typed DOM lookups for the sales page. */

/** The first element matching the selector, or a loud failure when the page markup lacks it. */
export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

/** The element with this id when it exists and is of the given type, otherwise null. */
export function maybeEl<T extends HTMLElement>(id: string, type: new () => T): T | null {
  const found = document.getElementById(id);
  return found instanceof type ? found : null;
}

/** The nearest element at or above the event target that matches the selector. */
export function closestOf<T extends HTMLElement = HTMLElement>(e: Event, selector: string): T | null {
  return e.target instanceof Element ? e.target.closest<T>(selector) : null;
}

/** A data-attribute value ('' when it is missing). */
export function ds(node: HTMLElement, key: string): string {
  return node.dataset[key] ?? '';
}

/** A media query, or null in a browser that cannot evaluate them. */
export function media(query: string): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

export function prefersReducedMotion(): boolean {
  return media('(prefers-reduced-motion: reduce)')?.matches === true;
}

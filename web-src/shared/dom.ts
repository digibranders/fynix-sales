/** Finds an element by id, or fails loudly so a typo in the page is caught straight away. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

/** Sets the label on a submit button and locks it while a request is running. */
export function busy(button: HTMLButtonElement, on: boolean, label: string): void {
  button.disabled = on;
  button.textContent = on ? 'One moment' : label;
}

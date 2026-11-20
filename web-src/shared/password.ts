/** Makes every Show/Hide button on the page reveal or hide the password field it points at. */
export function wirePasswordToggles(): void {
  document.querySelectorAll<HTMLButtonElement>('.eye').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset['eye'] ?? '');
      if (!(input instanceof HTMLInputElement)) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.classList.toggle('showing', show);
      if (!button.querySelector('svg')) {
        button.textContent = show ? 'Hide' : 'Show';
      }
      button.setAttribute('aria-pressed', show ? 'true' : 'false');
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

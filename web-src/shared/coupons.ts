import type { PayingClient } from '../admin/types.js';

export const RUPEE = '<svg class="cta-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10M7 9h10M7 5h2.5c3.2 0 5 1.7 5 4s-1.8 4-5 4H7l7.5 6"/></svg>';

/** Minor units (paise, cents) as money, for example 150000 INR is "₹1,500.00". */
export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return currency + ' ' + (cents / 100).toFixed(2);
  }
}

export function paidOn(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The paying clients of one salesperson: who, which code, how much, and when they last paid. */
export function clientCards(clients: PayingClient[], esc: (s: string) => string): string {
  if (clients.length === 0) return '<div class="empty"><b>No paying clients yet</b>Clients appear here once they pay using this person\'s coupon.</div>';
  return (
    '<div class="cl-list">' +
    clients
      .map(
        (c, i) =>
          '<div class="cl-card"><span class="cl-n">' + (i + 1) + '</span><div class="cl-who"><b>' + esc(c.name || 'Unnamed client') + '</b><span class="muted">' + esc(c.email) + '</span><span class="tag-chip">' + esc(c.code) + '</span></div>' +
          '<div class="cl-pay"><b>' + esc(money(c.amountCents, c.currency)) + '</b><small class="muted">Paid ' + esc(paidOn(c.paidAt)) + '</small></div></div>',
      )
      .join('') +
    '</div>'
  );
}

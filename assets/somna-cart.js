/**
 * Somna V2 — shared add-to-cart helper for the custom Somna sections.
 * Uses Shopify's cart API and the theme's CartLinesUpdateEvent so the existing cart drawer
 * opens and refreshes exactly as it does for the product form.
 */
import { CartLinesUpdateEvent } from '@shopify/events';

const root = () => (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

/**
 * @param {HTMLElement} source - element the event is dispatched from
 * @param {{ id: number|string, quantity?: number, selling_plan?: number|string|null }} item
 * @returns {Promise<object>} the updated cart
 */
export async function somnaAddToCart(source, item) {
  const line = { id: Number(item.id), quantity: item.quantity || 1 };
  if (item.selling_plan) line.selling_plan = Number(item.selling_plan);

  const deferred = CartLinesUpdateEvent.createPromise();
  source.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: String(line.id), quantity: line.quantity }],
      promise: deferred.promise,
    })
  );

  const sectionIds = [...document.querySelectorAll('cart-items-component')]
    .map((el) => el.dataset.sectionId)
    .filter(Boolean);

  try {
    const res = await fetch(`${root()}cart/add.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [line], sections: sectionIds.join(',') }),
    });
    const json = await res.json();
    if (!res.ok || json.status) throw new Error(json.description || json.message || 'Add to cart failed');

    const cart = await fetch(`${root()}cart.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json());
    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        items: cart.items,
        source: source.localName,
        sourceId: source.id || source.localName,
        itemCount: line.quantity,
        productId: String(line.id),
        sections: json.sections,
        didError: false,
      },
    });
    return cart;
  } catch (error) {
    deferred.reject(error);
    throw error;
  }
}

/** Format cents in the store currency. */
export function somnaMoney(cents, currency = 'USD', locale = document.documentElement.lang || 'en') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch (e) {
    return (cents / 100).toFixed(2);
  }
}

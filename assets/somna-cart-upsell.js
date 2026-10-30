/**
 * Somna V2 — cart drawer upsell "Add" buttons (snippets/cart-upsell-card.liquid), moved from the live
 * theme's custom.js. One /cart/add.js request also renders the cart drawer and the updated cart JSON
 * (sections/somna-cart-json.liquid), then the theme updates the drawer through CartLinesUpdateEvent.
 */
import { CartLinesUpdateEvent } from '@shopify/events';

// Cart drawer upsell "Add" buttons (snippets/cart-upsell-card.liquid)
// One request does everything: /cart/add.js also renders the cart drawer and the updated cart JSON
// (sections/somna-cart-json.liquid), so there's no follow-up /cart.js round trip before the drawer updates.
const CART_JSON_SECTION = 'somna-cart-json';
let upsellAddInFlight = false;

/** Updated cart from the add response's sections, or null if it's missing/unreadable. */
const cartFromSections = (sections) => {
  const html = sections?.[CART_JSON_SECTION];
  if (!html) return null;
  try {
    const json = new DOMParser().parseFromString(html, 'text/html').querySelector('script')?.textContent;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-ajax-form]');
  if (!form) return;

  e.preventDefault();
  const btn = form.querySelector('.hz-upsell-add-btn');
  // One upsell add at a time: overlapping adds would morph the drawer with an out-of-date render
  if (upsellAddInFlight || btn?.disabled) return;
  upsellAddInFlight = true;
  if (btn) btn.disabled = true;

  const formData = new FormData(form);
  const variantId = String(formData.get('id'));
  const quantity = Number(formData.get('quantity') || 1);

  // Re-render the cart drawer / cart page, plus the cart JSON, in the same request
  const sectionIds = [...document.querySelectorAll('cart-items-component')]
    .map((el) => el.dataset.sectionId)
    .filter(Boolean);
  formData.append('sections', [...sectionIds, CART_JSON_SECTION].join(','));

  const deferred = CartLinesUpdateEvent.createPromise();
  form.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: variantId, quantity }],
      promise: deferred.promise,
    })
  );

  try {
    const data = await fetch(Theme.routes.cart_add_url, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then((response) => response.json());

    // Fallback (e.g. on an add error, which returns no sections): fetch the cart as before
    const cart =
      cartFromSections(data.sections) ??
      (await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json()));

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        didError: Boolean(data.status),
        items: cart.items,
        itemCount: quantity,
        sections: data.sections,
        source: 'cart-upsell',
      },
    });

    if (data.status) console.error('Upsell add-to-cart error:', data.description || data.message);
  } catch (error) {
    console.error('Upsell add-to-cart error:', error);
    deferred.reject(error);
  } finally {
    upsellAddInFlight = false;
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

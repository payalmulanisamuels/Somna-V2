/* Somna V2 — global scroll reveal (approved option A · Soft fade-up).
 *
 * Per section, picks: headings (multi-line headings stagger their lines), text, images, repeated
 * items (cards, icons, product grid items, list rows: staggered) and buttons. Elements already on
 * screen at load are left alone; elements below the fold fade up as they reach 85% of the screen,
 * in the order heading -> text / image -> items -> button.
 *
 * Scrolling up never hides anything on screen: an element is reset only when it is completely below
 * the screen, then plays again on the way down. After revealing, all added classes/styles are removed,
 * so the element is back to its own CSS (hover effects etc.).
 *
 * Custom animations are never touched: the first section (hero), anything with data-no-reveal, the
 * PDP strip / layers / gift drawing / CTA product / shakes / waves, horizontal scrollers, and any
 * element that already has a CSS animation, translate or scale.
 *
 * Desktop + tablet only (>= 750px; mobile design pending). Off for prefers-reduced-motion.
 * No library; one passive scroll listener for the whole page (checks only tracked elements).
 */
(() => {
  if (window.SomnaReveal) return;

  const MQ = matchMedia('(min-width: 750px) and (prefers-reduced-motion: no-preference)');
  const SKIP = [
    '[data-no-reveal]', 'header', 'footer', 'dialog', 'iframe', 'details:not([open]) > :not(summary)',
    'somna-pdp-how', 'somna-pdp-layers', '.somna-pdp-layers-traveller', '.somna-pdp-story__visual', '.somna-pdp-story__frame',
    '.somna-pdp-story__bullets', '.somna-pdp-story__layers', '.somna-pdp-cta__media', '.somna-pdp-pair svg',
    '.somna-icon', '[class*="somna-shake--"]', '.somna-wave', 'somna-wave', 'marquee-component', 'slideshow-component',
    '.slideshow', 'svg',
  ].join(',');
  // containers holding one of these are left alone too (so the custom animation's parent never moves)
  const HOLDS = SKIP.replace(',svg', '').replace('details:not([open]) > :not(summary),', '');
  const EASE3 = 'cubic-bezier(0.215, 0.61, 0.355, 1)'; // power3.out
  const TYPE = {
    heading: { rank: 0, d: 0.7, e: EASE3 },
    line: { rank: 0, d: 0.7, e: EASE3 },
    text: { rank: 1, d: 0.6 },
    image: { rank: 1, d: 1.0, e: EASE3 },
    item: { rank: 2, d: 0.5 },
    button: { rank: 3, d: 0.6 },
  };
  const BASE = { heading: 0, line: 0, text: 0.15, image: 0.1, item: 0.25, button: 0.4 };

  const all = new Map(); // element -> { type, section }
  let pending = false;
  let raf = 0;
  let timer = 0;

  const skippable = (el, section) => {
    if (el.closest(SKIP)) return true;
    const cs = getComputedStyle(el);
    if (cs.animationName !== 'none' || cs.translate !== 'none' || cs.scale !== 'none') return true;
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.position === 'fixed' || cs.position === 'sticky') return true;
    for (let a = el.parentElement; a && a !== section; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll)/.test(s.overflowX) || s.position === 'sticky' || s.position === 'fixed') return true;
    }
    return false;
  };

  function collect(section) {
    const picked = [];
    const taken = (el) => picked.some((p) => p.el === el || p.el.contains(el) || el.contains(p.el));
    const add = (el, type) => {
      if (!el || taken(el) || skippable(el, section) || el.querySelector(HOLDS)) return;
      picked.push({ el, type });
    };

    // repeated items: a container with 3+ element children of the same kind (cards, icons, grid items, rows)
    section.querySelectorAll('ul, ol, div, section, product-grid, .product-grid').forEach((box) => {
      const kids = [...box.children].filter((k) => !/^(SCRIPT|STYLE|TEMPLATE|INPUT|BR)$/.test(k.tagName));
      if (kids.length < 3 || kids.length > 24) return;
      const sig = (k) => k.tagName + '.' + (k.classList[0] || '');
      if (!kids.every((k) => sig(k) === sig(kids[0]))) return;
      if (getComputedStyle(kids[0]).display.startsWith('inline')) return;
      if (box.closest('h1, h2, h3, p, a, button, table')) return;
      kids.forEach((k) => add(k, 'item'));
    });

    section.querySelectorAll('h1, h2, h3').forEach((h) => {
      const lines = [...h.children].filter((c) => getComputedStyle(c).display === 'block');
      if (lines.length >= 2) lines.forEach((l) => add(l, 'line'));
      else add(h, 'heading');
    });
    section.querySelectorAll('p, .rte, blockquote').forEach((p) => {
      if (!p.textContent.trim() || p.closest('a, button, label, li, td, th')) return;
      add(p, 'text');
    });
    section.querySelectorAll('img, video').forEach((m) => {
      if (m.closest('a.button, button')) return;
      const r = m.getBoundingClientRect();
      if (r.width && r.width < 80) return;
      add(m, 'image');
    });
    section.querySelectorAll('a.button, button.button, .button, .btn, [class*="__button"]').forEach((b) => add(b, 'button'));
    return picked.slice(0, 80);
  }

  function arm(el) {
    el.classList.remove('is-in');
    el.style.removeProperty('--somna-r-delay');
    el.classList.add('somna-r', 'somna-r--' + (all.get(el).type === 'line' ? 'text' : all.get(el).type));
  }

  function clean(el) {
    el.classList.remove('somna-r', 'is-in', 'somna-r--text', 'somna-r--image', 'somna-r--item', 'somna-r--heading', 'somna-r--button');
    ['--somna-r-delay', '--somna-r-d', '--somna-r-e'].forEach((p) => el.style.removeProperty(p));
  }

  function reveal(batch) {
    // order: heading/lines -> text & image -> items -> button, then document order
    batch.sort((a, b) => TYPE[all.get(a).type].rank - TYPE[all.get(b).type].rank || (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    const n = {};
    batch.forEach((el) => {
      const { type } = all.get(el);
      const t = TYPE[type];
      const i = (n[type] = (n[type] ?? -1) + 1);
      const step = type === 'item' ? 0.12 : type === 'line' ? 0.12 : 0.08;
      const delay = Math.min(1, BASE[type] + i * step);
      const go = () => {
        el.style.setProperty('--somna-r-d', t.d + 's');
        el.style.setProperty('--somna-r-delay', delay + 's');
        if (t.e) el.style.setProperty('--somna-r-e', t.e);
        el.classList.add('is-in');
        const done = (e) => {
          if (e.target !== el || e.propertyName !== 'opacity') return;
          el.removeEventListener('transitionend', done);
          if (el.classList.contains('is-in')) clean(el);
        };
        el.addEventListener('transitionend', done);
        // safety: never leave anything hidden if transitionend is missed
        setTimeout(() => el.classList.contains('is-in') && clean(el), (t.d + delay) * 1000 + 300);
      };
      // lazy images: wait for the picture (max 1.5s) so the fade isn't spent on an empty box
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth)) {
        let fired = false;
        el.somnaWaiting = true;
        const once = () => { if (!fired) { fired = true; el.somnaWaiting = false; go(); } };
        el.addEventListener('load', once, { once: true });
        el.addEventListener('error', once, { once: true });
        setTimeout(once, 1500);
      } else go();
    });
  }

  /* One cheap check per frame while scrolling (reads first, then writes). Every armed element whose top
     has passed 85% of the screen is revealed — including ones skipped over by a fast scroll — so nothing
     can stay hidden; shown elements are re-armed only when completely below the screen. */
  function check() {
    pending = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    const vh = innerHeight;
    const line = vh * 0.85;
    const show = [];
    const hide = [];
    for (const el of all.keys()) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue; // not rendered (closed tab, collapsed) — leave it
      const armed = el.classList.contains('somna-r');
      const playing = el.classList.contains('is-in');
      if (armed && !playing) {
        if (r.top < line && !el.somnaWaiting) show.push(el);
      } else if (r.top >= vh) {
        hide.push(el);
      }
    }
    hide.forEach(arm);
    if (show.length) reveal(show);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    raf = requestAnimationFrame(check);
    timer = setTimeout(check, 120); // whichever comes first
  }

  function observe(section) {
    if (!section || section.dataset.somnaReveal) return;
    section.dataset.somnaReveal = '1';
    collect(section).forEach(({ el, type }) => {
      all.set(el, { type, section });
      if (el.getBoundingClientRect().top >= innerHeight) arm(el); // below the fold: hidden until it scrolls in
    });
    schedule();
  }

  function unobserve(section) {
    if (!section) return;
    delete section.dataset.somnaReveal;
    for (const [el, info] of all) {
      if (info.section !== section) continue;
      clean(el);
      all.delete(el);
    }
  }

  function init() {
    if (!MQ.matches) return;
    const sections = [...document.querySelectorAll('main .shopify-section')];
    sections.slice(1).forEach(observe); // the first section (hero) keeps its own entrance
    // scroll events from any scroller (the page may scroll inside .page-wrapper)
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
    // tabs / accordions / late content change layout without scrolling
    document.addEventListener('click', () => setTimeout(schedule, 60), { capture: true, passive: true });
    const main = document.querySelector('main');
    if (main && 'ResizeObserver' in window) new ResizeObserver(schedule).observe(main);
    document.addEventListener('shopify:section:load', (e) => observe(e.target));
    document.addEventListener('shopify:section:unload', (e) => unobserve(e.target));
  }

  window.SomnaReveal = { observe, unobserve };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

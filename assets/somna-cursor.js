/**
 * Somna V2 — custom cursor ("D · Stardust trail", approved demo).
 *
 * A small dot sits exactly on the pointer (the click point). A crescent moon (Figma 4397:1501) with a breathing wave
 * follows it with soft easing and leaves a short trail of twinkling stardust. On links, buttons,
 * product cards and galleries the moon swells towards a full moon; a click scatters a few stars.
 *
 * Safe by design:
 * - Only runs with a mouse or trackpad (hover + fine pointer); touch devices keep their normal behaviour.
 * - The native cursor is hidden only after this script has drawn the custom one (class on <html>),
 *   so if anything fails the normal cursor stays.
 * - Text fields, editable areas, iframes and disabled/busy controls show the native cursor instead.
 * - Never takes pointer events or focus. Lives in the top layer (popover) so it stays above the cart
 *   drawer, quick add, zoom and other modal dialogs.
 * - Reduced motion: no easing, trail, breathing or burst — the moon simply sits on the pointer.
 * - Animates only while something moves; idle otherwise.
 */
(function () {
  if (window.SomnaCursor) return;
  var mq = window.matchMedia;
  if (!mq || !mq('(hover: hover) and (pointer: fine)').matches) return;

  var doc = document.documentElement;
  var reduceMq = mq('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;

  var TEXT = 'input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"],[type="image"]), textarea, [contenteditable=""], [contenteditable="true"]';
  var NATIVE = TEXT + ', iframe, :disabled, [aria-disabled="true"], [aria-busy="true"], [data-cursor="native"]';
  var INTERACTIVE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="option"], [role="menuitem"], label, summary, select, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], [data-cursor="hover"]';
  // a product card or gallery is one hover zone: one steady moon state and colour across everything inside it
  var ZONE = 'product-card, .resource-card, .collection-card, media-gallery, .card-gallery, .somna-rv__card, .somna-strip__card, .somna-match__card, .somna-buy__gallery, .somna-buy__pack, [data-cursor-zone]';

  var root, dot, moon, cv, ctx;
  try {
    root = document.createElement('div');
    root.className = 'somna-cursor';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<canvas class="somna-cursor__fx"></canvas>' +
      '<span class="somna-cursor__moon"><svg viewBox="0 0 34 34" focusable="false">' +
        '<defs><mask id="somna-cursor-cut"><rect x="-4" y="-4" width="42" height="42" fill="#fff"/>' +
        '<circle class="somna-cursor__cut" cx="17.43" cy="12.57" r="8.34" fill="#000"/></mask></defs>' +
        '<circle class="somna-cursor__body" cx="15" cy="15" r="11" mask="url(#somna-cursor-cut)"/>' +
        '<path class="somna-cursor__wave" d="M7 30c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0 5-2.6 7.5 0"/>' +
      '</svg></span>' +
      '<span class="somna-cursor__dot"></span>';
    cv = root.querySelector('canvas');
    ctx = cv.getContext('2d');
    moon = root.querySelector('.somna-cursor__moon');
    dot = root.querySelector('.somna-cursor__dot');
    if (!ctx) throw new Error('no canvas');
    // top layer when supported, so modal dialogs (cart drawer, quick add, zoom) never cover it
    if (typeof root.showPopover === 'function') root.setAttribute('popover', 'manual');
    document.body.appendChild(root);
  } catch (err) {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    return; // native cursor stays
  }

  var mx = -100, my = -100, moonX = -100, moonY = -100;
  var last = 0, raf = 0, seen = false, lastTarget = null, offTimer = 0, acc = 0;
  var parts = [], vw = 0, vh = 0, dpr = 1;
  var tone = new WeakMap();

  function reduced() { return reduceMq.matches; }

  function raise() {
    if (!root.hasAttribute('popover')) return;
    try { if (root.matches(':popover-open')) root.hidePopover(); root.showPopover(); } catch (e) { /* ignore */ }
  }

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  }

  // light or dark ground under the pointer: first solid background up the tree (cached per element)
  function isDark(el) {
    if (tone.has(el)) return tone.get(el);
    var node = el, dark = false;
    while (node && node.nodeType === 1) {
      var hint = node.getAttribute('data-cursor-tone');
      if (hint) { dark = hint === 'dark'; break; }
      var m = getComputedStyle(node).backgroundColor.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
      if (m) {
        var alpha = m[4] === undefined ? 1 : (m[4].indexOf('%') > -1 ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
        if (alpha > 0.5) { dark = (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) < 140; break; }
      }
      node = node.parentElement;
    }
    tone.set(el, dark);
    return dark;
  }

  function setHover(on) {
    clearTimeout(offTimer);
    if (on) { root.classList.add('is-hover'); return; }
    // short grace period so gaps between thumbnails or buttons don't make the moon flicker
    offTimer = setTimeout(function () { root.classList.remove('is-hover'); }, 140);
  }

  function evaluate(t) {
    if (!(t instanceof Element) || t === lastTarget) return;
    lastTarget = t;
    var native = !!t.closest(NATIVE);
    root.classList.toggle('is-native', native);
    if (native) { setHover(false); return; }
    var zone = t.closest(ZONE);
    setHover(!!zone || !!t.closest(INTERACTIVE));
    root.classList.toggle('on-dark', isDark(zone || t));
  }

  function palette() { return root.classList.contains('on-dark') ? ['#afbdf8', '#f3feee'] : ['#0b0f1d', '#8d9ef0']; }

  function spawn(x, y, vx, vy, life, r, star, f) {
    if (parts.length > 70) parts.shift();
    var pal = palette();
    parts.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, r: r, star: star, f: f || 0.985, c: pal[Math.random() < 0.55 ? 0 : 1], s: Math.random() * TAU });
  }

  function burst(x, y) {
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * TAU + Math.random() * 0.3, sp = 1.6 + Math.random() * 1.8;
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 520 + Math.random() * 300, 1.2 + Math.random() * 1.6, i % 2 === 0, 0.9);
    }
  }

  function star(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  function drawDust(dt, now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    var k = dt / 16.67;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * k; p.y += p.vy * k;
      var fr = Math.pow(p.f, k); p.vx *= fr; p.vy *= fr;
      var a = p.life / p.max, tw = 0.6 + 0.4 * Math.sin(now / 85 + p.s);
      ctx.globalAlpha = Math.max(0, a * tw);
      ctx.fillStyle = p.c;
      if (p.star) star(p.x, p.y, p.r * 2.4 * (0.6 + 0.4 * a));
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + 0.5 * a), 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    return parts.length;
  }

  function place(el, x, y) { el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }

  function frame(now) {
    var dt = last ? Math.min(64, now - last) : 16;
    last = now;
    if (reduced()) {
      moonX = mx; moonY = my;
    } else {
      // frame-rate independent easing: the moon closes ~30% of the gap per 60 Hz frame
      var km = 1 - Math.pow(0.7, dt / 16.67);
      moonX += (mx - moonX) * km; moonY += (my - moonY) * km;
    }
    place(dot, mx, my);
    place(moon, moonX, moonY);
    var busy = 0;
    if (!reduced()) busy = drawDust(dt, now);
    else if (parts.length) { parts.length = 0; ctx.clearRect(0, 0, cv.width, cv.height); }
    var settled = !busy && Math.abs(mx - moonX) < 0.1 && Math.abs(my - moonY) < 0.1;
    if (settled) { raf = 0; last = 0; } else raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function hide() { root.classList.remove('is-visible', 'is-down'); }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') { hide(); return; }
    var dx = e.clientX - mx, dy = e.clientY - my;
    mx = e.clientX; my = e.clientY;
    if (!seen) {
      seen = true;
      moonX = mx; moonY = my;
      sizeCanvas();
      raise();
      doc.classList.add('somna-cursor-on');
    } else if (!reduced() && !root.classList.contains('is-native')) {
      acc += Math.hypot(dx, dy);
      while (acc > 10) {
        acc -= 10;
        // dust leaves from the moon's body, drifts against the motion and floats upward
        spawn(moonX - 8 + (Math.random() * 8 - 4), moonY + 1 + (Math.random() * 8 - 4),
          -dx * 0.02 + (Math.random() - 0.5) * 0.4, -0.25 - Math.random() * 0.35,
          900 + Math.random() * 700, 1.1 + Math.random() * 1.6, Math.random() < 0.45);
      }
    }
    evaluate(e.target);
    root.classList.add('is-visible');
    kick();
  }

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || root.classList.contains('is-native')) return;
    root.classList.add('is-down');
    if (!reduced()) { burst(mx, my); kick(); }
  }, { passive: true });
  window.addEventListener('pointerup', function () {
    root.classList.remove('is-down');
    lastTarget = null; // a click can open a drawer or mark a button busy: re-check on the next move
  }, { passive: true });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hide(); });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', sizeCanvas, { passive: true });
  document.addEventListener('scroll', function () { lastTarget = null; }, { passive: true, capture: true });

  // any dialog or popover opened later joins the top layer above us; raise the cursor again
  new MutationObserver(function () { lastTarget = null; raise(); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('toggle', function (e) {
    if (e.target !== root && e.newState === 'open') raise();
  }, true);

  window.SomnaCursor = { raise: raise };
})();

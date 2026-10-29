/**
 * Somna V2 — animated wave dividers ("K2"): soft, even waves rolling slowly left to right,
 * with a slower counter-ripple so the crests keep changing height like water, and the drops
 * bobbing on the surface. Same drawing as the approved demo.
 *
 * Each .somna-wave holds a <canvas data-somna-wave>. Until this runs (or if it can't), the static
 * CSS-masked wave underneath shows the same shape. Animation pauses off screen, in background tabs
 * and for prefers-reduced-motion (one still frame is drawn instead).
 */
(function () {
  if (window.SomnaWave) return;

  var TAU = Math.PI * 2;
  var ASPECT = 0.85; // horizontal units per vertical unit, matched to the approved K2 demo
  // drop positions on the 1440 × 160 design grid: x, rx, ry, rotation (deg)
  var DROPS = [
    [834.3, 6.5, 5, -15],
    [615.6, 6, 4.5, -15],
    [1033.3, 8.5, 7, 25],
    [418.8, 8, 6.5, -25],
    [1050.9, 5, 4.5, 25],
    [402.3, 5.5, 4.5, -25]
  ];
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var waves = [];
  var running = false;
  var last = 0;

  // surface height on the 160-unit grid; phase advances by one per wave length
  function surface(u, phase) {
    return 80 - 24 * Math.sin(TAU * (u / 360 - phase)) + 4 * Math.sin(TAU * (u / 830 + phase * 0.35));
  }

  function Wave(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas[data-somna-wave]');
    this.ctx = this.canvas.getContext('2d');
    this.roll = parseFloat(root.getAttribute('data-roll')) || 8;
    this.animate = root.getAttribute('data-animate') !== 'false';
    this.drops = root.getAttribute('data-drops') !== 'false';
    this.phase = 0;
    this.visible = false;
    this.w = 0;
    this.h = 0;
    this.colour = getComputedStyle(root).getPropertyValue('--somna-wave-bottom').trim() || '#f3feee';
    root.classList.add('somna-wave--live');
  }

  Wave.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.w || h !== this.h) {
      this.w = this.canvas.width = w;
      this.h = this.canvas.height = h;
      this.dpr = dpr;
    }
  };

  Wave.prototype.draw = function () {
    var ctx = this.ctx, W = this.w, H = this.h;
    if (!W || !H) return;
    // the wave keeps the demo's proportions at any width: one 1440-unit tile is 7.65 × the height
    var sy = H / 160, sx = sy * ASPECT, step = 3 * this.dpr, p = this.phase, x;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.colour;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (x = 0; x <= W + step; x += step) ctx.lineTo(x, surface(x / sx, p) * sy);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    if (!this.drops) return;
    var tiles = Math.ceil(W / (1440 * sx));
    for (var k = 0; k < tiles; k++) for (var i = 0; i < DROPS.length; i++) {
      var d = DROPS[i], u = d[0] + k * 1440;
      if (u * sx > W + 20) continue;
      ctx.save();
      ctx.translate(u * sx, (surface(u, p) - 12 - d[2]) * sy);
      ctx.rotate(d[3] * Math.PI / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, d[1] * sx * 1.1, d[2] * sy, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };

  function tick(now) {
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    var active = 0;
    for (var i = 0; i < waves.length; i++) {
      var wv = waves[i];
      if (!wv.visible || !wv.animate || reduce.matches) continue;
      wv.phase += dt / wv.roll;
      wv.draw();
      active++;
    }
    if (active && !document.hidden) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      last = 0;
    }
  }

  function start() {
    if (running || reduce.matches || document.hidden) return;
    running = true;
    requestAnimationFrame(tick);
  }

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var wv = en.target.__somnaWave;
      if (!wv) return;
      wv.visible = en.isIntersecting;
      if (wv.visible) { wv.draw(); start(); }
    });
  }, { rootMargin: '100px 0px' }) : null;

  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) {
      var wv = en.target.parentNode && en.target.parentNode.__somnaWave;
      if (wv) { wv.resize(); wv.draw(); }
    });
  }) : null;

  function init(scope) {
    var roots = (scope || document).querySelectorAll('.somna-wave');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.__somnaWave || !root.querySelector('canvas[data-somna-wave]')) continue;
      var wv = new Wave(root);
      root.__somnaWave = wv;
      waves.push(wv);
      wv.resize();
      wv.draw();
      if (io) io.observe(root); else { wv.visible = true; }
      if (ro) ro.observe(wv.canvas);
    }
    start();
  }

  function prune() {
    waves = waves.filter(function (wv) { return document.contains(wv.root); });
  }

  document.addEventListener('visibilitychange', start);
  if (reduce.addEventListener) reduce.addEventListener('change', function () { waves.forEach(function (w) { w.draw(); }); start(); });
  // theme editor: sections are re-rendered in place
  document.addEventListener('shopify:section:load', function (e) { prune(); init(e.target); });
  document.addEventListener('shopify:section:unload', prune);

  window.SomnaWave = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();

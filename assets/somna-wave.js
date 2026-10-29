/**
 * Somna V2 — animated wave dividers ("K2"): soft, even waves rolling slowly left to right,
 * with a slower counter-ripple so the crests keep changing height like water, and the drops
 * bobbing on the surface. Same drawing as the approved demo.
 *
 * Figma shapes (.somna-wave--shape): the traced Figma edge and drops are read from the SVG in the
 * snippet. The curve stays where Figma puts it while a K2 swell rolls through it left to right, and
 * the drops drift with the swell at a quarter of its speed ("B+", approved demo). At rest (first
 * frame, reduced motion) the wave is exactly the Figma frame.
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
    this.svg = root.classList.contains('somna-wave--shape') ? root.querySelector('svg') : null;
    if (this.svg) readShape(this);
    root.classList.add('somna-wave--live');
  }

  // Figma shapes: edge profile (1 value per design unit), colours and drops from the SVG
  function readShape(wv) {
    var svg = wv.svg;
    var vb = svg.viewBox.baseVal;
    var path = svg.querySelector('path');
    var rect = svg.querySelector('rect');
    var d = path.getAttribute('d');
    var pts = [], cx = 0, cy = 0, re = /([MLQZ])([^MLQZ]*)/g, m, n, t, k;
    while ((m = re.exec(d))) {
      n = m[2].split(/[ ,]+/).filter(Boolean).map(Number);
      if (m[1] === 'M' || m[1] === 'L') { cx = n[0]; cy = n[1]; pts.push([cx, cy]); }
      else if (m[1] === 'Q') {
        for (k = 1; k <= 6; k++) {
          t = k / 6;
          pts.push([(1 - t) * (1 - t) * cx + 2 * (1 - t) * t * n[0] + t * t * n[2], (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * n[1] + t * t * n[3]]);
        }
        cx = n[2]; cy = n[3];
      }
    }
    pts = pts.filter(function (p) { return p[0] >= 0 && p[0] <= 1440; });
    var prof = new Float32Array(1441), j = 0;
    for (var x = 0; x <= 1440; x++) {
      while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
      var a = pts[j], b = pts[j + 1] || a, span = b[0] - a[0];
      prof[x] = span > 0 ? a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, (x - a[0]) / span)) : a[1];
    }
    wv.prof = prof;
    wv.units = vb.height;
    wv.below = d.indexOf('M-4,-2') !== 0; // the filled region is below the edge (else above it)
    wv.fill = path.getAttribute('fill');
    wv.bg = rect ? rect.getAttribute('fill') : '';
    wv.dropList = Array.prototype.map.call(svg.querySelectorAll('ellipse'), function (e) {
      var r = /rotate\(([-\d.]+)/.exec(e.getAttribute('transform') || '');
      return [+e.getAttribute('cx'), +e.getAttribute('cy'), +e.getAttribute('rx'), +e.getAttribute('ry'), r ? +r[1] : 0, e.getAttribute('fill')];
    });
  }

  var PERIOD = 2880; // the shape followed by its mirror image
  function edgeAt(prof, u) {
    var v = u % PERIOD;
    if (v < 0) v += PERIOD;
    if (v > 1440) v = PERIOD - v;
    var i = Math.floor(v), f = v - i;
    return i >= 1440 ? prof[1440] : prof[i] + (prof[i + 1] - prof[i]) * f;
  }

  // "B+" (approved demo): the Figma curve stays put, a K2 swell rolls through it left to right
  // (one 360-unit wave per roll, 13 units high, plus the K2 counter-ripple), and the drops drift
  // with the swell at a quarter of its speed, keeping their Figma distance from the surface.
  var SWELL = 13, DROP_SPEED = 0.25;
  Wave.prototype.drawShape = function () {
    var ctx = this.ctx, W = this.w, H = this.h, dpr = this.dpr || 1;
    if (!W || !H) return;
    var cr = this.canvas.getBoundingClientRect(), sr = this.svg.getBoundingClientRect();
    if (!sr.width) return;
    var sx = sr.width / 1440 * dpr, sy = H / this.units;
    // svg is centred in the wave; when flipped both are mirrored by CSS, so measure unflipped
    var ox = (sr.left - cr.left) * dpr;
    var still = !this.animate || reduce.matches;
    var p = still ? 0 : this.phase;
    var A = still ? 0 : SWELL * Math.min(1, p * 2); // eases in from the exact Figma frame
    var prof = this.prof;
    var swell = function (u) { return A * Math.sin(TAU * (u / 360 - p)) + 0.4 * A * Math.sin(TAU * (u / 830 + p * 0.35)); };
    var surf = function (u) { return edgeAt(prof, u) + swell(u); };
    var step = 2 * dpr, x, u;
    ctx.clearRect(0, 0, W, H);
    if (this.bg) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = this.fill;
    ctx.beginPath();
    var edgeY = this.below ? H + 2 : -2;
    ctx.moveTo(0, edgeY);
    for (x = 0; x <= W + step; x += step) {
      u = (x - ox) / sx;
      ctx.lineTo(x, surf(u) * sy);
    }
    ctx.lineTo(W + step, edgeY);
    ctx.closePath();
    ctx.fill();
    if (!this.drops) return;
    var travel = p * 360 * DROP_SPEED;
    for (var i = 0; i < this.dropList.length; i++) {
      var dr = this.dropList[i];
      var off = Math.max(-18, Math.min(18, dr[1] - edgeAt(prof, dr[0])));
      u = (dr[0] + travel) % 1440;
      var y = surf(u) + off, rmax = Math.max(dr[2], dr[3]);
      y = Math.max(rmax + 1, Math.min(this.units - rmax - 1, y));
      var tilt = Math.atan((surf(u + 3) - surf(u - 3)) / 6) * 180 / Math.PI * 0.6;
      ctx.save();
      ctx.translate(ox + u * sx, y * sy);
      ctx.scale(sx, sy);
      ctx.rotate((dr[4] + (still ? 0 : tilt)) * Math.PI / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, dr[2], dr[3], 0, 0, TAU);
      ctx.fillStyle = dr[5];
      ctx.fill();
      ctx.restore();
    }
  };

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
    if (this.svg) return this.drawShape();
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

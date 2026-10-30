/**
 * Somna V2 — customer reviews from a Google Sheet for sections/somna-reviews.liquid.
 *
 * Source: the sheet's share link (converted to its public CSV export), a published CSV link,
 * or a JSON endpoint (e.g. an Apps Script web app) returning an array of row objects.
 * Columns are matched by header name, so the merchant can reorder or add columns freely.
 *
 * - One request per source per page (shared promise) and a 10-minute sessionStorage cache.
 * - Text is only ever inserted with textContent; image URLs must be https.
 * - Rows marked as sample data (sample_status mentions sample / fictional / test) are shown in
 *   theme previews only — never on the live (main) theme.
 */
(function () {
  if (customElements.get('somna-reviews')) return;

  var TTL = 10 * 60 * 1000;
  var pending = {};

  var COLS = {
    name: ['reviewer_name', 'name', 'customer', 'customer_name', 'author'],
    title: ['review_title', 'title', 'headline'],
    body: ['review_body', 'body', 'review', 'content', 'text', 'comment'],
    rating: ['rating', 'stars', 'score'],
    photo: ['review_photo', 'reviewer_photo', 'photo', 'image', 'customer_photo', 'photo_url'],
    avatar: ['avatar', 'profile_photo', 'reviewer_avatar', 'profile_image'],
    product: ['product_title', 'product', 'product_name'],
    date: ['date', 'review_date', 'created_at', 'submitted_at'],
    verified: ['verified', 'verified_buyer', 'verified_purchase'],
    sample: ['sample_status', 'status']
  };

  function sourceUrl(raw) {
    var url;
    try { url = new URL(raw, location.href); } catch (e) { return ''; }
    if (url.protocol !== 'https:') return '';
    var m = /^\/spreadsheets\/d\/([\w-]+)/.exec(url.pathname);
    if (url.hostname === 'docs.google.com' && m && !/\/(export|gviz|pub)/.test(url.pathname)) {
      var gid = (url.hash.match(/gid=(\d+)/) || url.search.match(/gid=(\d+)/) || [])[1] || '0';
      return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/export?format=csv&gid=' + gid;
    }
    return url.href;
  }

  function parseCsv(text) {
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, '_'); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = r[k] == null ? '' : r[k]; });
      return o;
    });
  }

  function toObjects(text, type) {
    var t = text.trim();
    if (/json/.test(type) || t[0] === '[' || t[0] === '{') {
      var data = JSON.parse(t);
      if (!Array.isArray(data)) data = data.reviews || data.rows || data.data || [];
      return data.map(function (o) {
        var n = {};
        Object.keys(o || {}).forEach(function (k) { n[k.trim().toLowerCase().replace(/\s+/g, '_')] = o[k] == null ? '' : String(o[k]); });
        return n;
      });
    }
    return parseCsv(text);
  }

  function pick(row, key) {
    var keys = COLS[key];
    for (var i = 0; i < keys.length; i++) if (row[keys[i]] != null && String(row[keys[i]]).trim() !== '') return String(row[keys[i]]).trim();
    return '';
  }

  function safeImage(v) {
    if (!v) return '';
    try {
      var u = new URL(v);
      return u.protocol === 'https:' ? u.href : '';
    } catch (e) { return ''; }
  }

  function normalise(rows) {
    var seen = {}, out = [];
    rows.forEach(function (row) {
      var body = pick(row, 'body');
      var rating = parseFloat(pick(row, 'rating'));
      if (!body || !(rating >= 1)) return;
      rating = Math.min(5, Math.round(rating));
      var r = {
        name: pick(row, 'name'),
        title: pick(row, 'title'),
        body: body,
        rating: rating,
        photo: safeImage(pick(row, 'photo')),
        avatar: safeImage(pick(row, 'avatar')),
        product: pick(row, 'product'),
        date: pick(row, 'date'),
        verified: /^(y|yes|true|1|verified)$/i.test(pick(row, 'verified')),
        sample: /sample|fictional|test|dummy/i.test(pick(row, 'sample'))
      };
      var key = (r.name + '|' + r.body + '|' + r.rating).toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(r);
    });
    return out;
  }

  function load(src, force) {
    var cacheKey = 'somna-reviews:' + src;
    if (!force) {
      try {
        var c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (c && Date.now() - c.t < TTL && Array.isArray(c.rows)) return Promise.resolve(c.rows);
      } catch (e) {}
      if (pending[src]) return pending[src];
    }
    pending[src] = fetch(src, { credentials: 'omit', headers: { Accept: 'text/csv, application/json, text/plain' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var type = res.headers.get('content-type') || '';
        if (/text\/html/.test(type)) throw new Error('The sheet is not shared publicly');
        return res.text().then(function (text) { return normalise(toObjects(text, type)); });
      })
      .then(function (rows) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) {}
        return rows;
      })
      .catch(function (err) {
        delete pending[src];
        throw err;
      });
    return pending[src];
  }

  function shortName(name) {
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return name;
    var last = parts[parts.length - 1];
    return parts[0] + ' ' + (/^[a-z]\.?$/i.test(last) ? last.replace(/\.?$/, '.') : last[0].toUpperCase() + '.');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  class SomnaReviews extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      var d = this.dataset;
      this.src = sourceUrl(d.src || '');
      this.initial = parseInt(d.initial, 10) || 4;
      this.batch = parseInt(d.batch, 10) || 4;
      this.opts = {
        photos: d.photos === 'true',
        verified: d.verified === 'true',
        product: d.product === 'true',
        dates: d.dates === 'true',
        shortNames: d.names !== 'full'
      };
      var theme = window.Shopify && window.Shopify.theme;
      this.preview = !!(window.Shopify && window.Shopify.designMode) || !theme || theme.role !== 'main';
      this.allowSamples = d.samples === 'true' && this.preview;
      this.list = this.querySelector('[data-list]');
      this.chips = this.querySelector('[data-chips]');
      this.more = this.querySelector('[data-more]');
      this.status = this.querySelector('[data-status]');
      this.note = this.querySelector('[data-note]');
      var tpl = this.parentNode && this.parentNode.querySelector('template[data-somna-review-star]');
      this.starSvg = tpl ? tpl.innerHTML : '';
      this.filter = 'all';
      this.shown = 0;

      var self = this;
      if (this.chips) this.chips.addEventListener('click', function (e) {
        var b = e.target.closest('[data-filter]');
        if (b) self.setFilter(b.dataset.filter);
      });
      if (this.more) this.more.addEventListener('click', function () { self.showMore(); });
      if (!this.src) { this.list.setAttribute('aria-busy', 'false'); return; }
      this.fetch(false);
    }

    fetch(force) {
      var self = this;
      this.list.setAttribute('aria-busy', 'true');
      this.status.hidden = true;
      load(this.src, force).then(function (rows) {
        var sampleRows = rows.filter(function (r) { return r.sample; });
        self.rows = rows.filter(function (r) { return !r.sample || self.allowSamples; });
        if (self.note) {
          self.note.textContent = self.dataset.sampleNote || '';
          self.note.hidden = !(self.allowSamples && sampleRows.length && self.note.textContent);
        }
        if (self.chips) {
          self.chips.hidden = !self.rows.length;
          var hasPhotos = self.rows.some(function (r) { return r.photo; });
          var pb = self.chips.querySelector('[data-filter="photos"]');
          if (pb) pb.hidden = !hasPhotos;
        }
        self.setFilter(self.filter, true);
      }).catch(function () {
        self.rows = null;
        self.list.textContent = '';
        self.list.setAttribute('aria-busy', 'false');
        if (self.chips) self.chips.hidden = true;
        self.more.hidden = true;
        self.status.textContent = self.dataset.error || '';
        var retry = el('button', '', self.dataset.retry || 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', function () { self.fetch(true); });
        self.status.appendChild(retry);
        self.status.hidden = false;
      });
    }

    matches(r) {
      switch (this.filter) {
        case '5': return r.rating === 5;
        case '4': return r.rating === 4;
        case 'low': return r.rating <= 3;
        case 'photos': return !!r.photo;
        default: return true;
      }
    }

    setFilter(name, keepScroll) {
      if (!this.rows) return;
      this.filter = name || 'all';
      if (this.chips) this.chips.querySelectorAll('[data-filter]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.filter === name));
      });
      var self = this;
      this.filtered = this.rows.filter(function (r) { return self.matches(r); });
      this.list.textContent = '';
      this.shown = 0;
      this.render(this.initial);
    }

    showMore() {
      var start = this.shown;
      this.render(this.batch);
      var next = this.list.children[start];
      if (next) {
        var focusable = next.querySelector('h3, p');
        if (focusable) { focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
      }
    }

    render(count) {
      var slice = this.filtered.slice(this.shown, this.shown + count);
      var frag = document.createDocumentFragment();
      var self = this;
      slice.forEach(function (r) { frag.appendChild(self.card(r)); });
      this.list.appendChild(frag);
      this.shown += slice.length;
      this.list.setAttribute('aria-busy', 'false');
      // nothing to show at all (e.g. only sample rows on the live store): stay quiet
      var none = !this.filtered.length && this.rows.length > 0;
      this.status.textContent = none ? (this.dataset.empty || '') : '';
      this.status.hidden = !none;
      this.more.hidden = this.shown >= this.filtered.length;
    }

    stars(rating) {
      var wrap = el('span', 'somna-reviews__stars');
      wrap.setAttribute('role', 'img');
      wrap.setAttribute('aria-label', rating + ' out of 5 stars');
      for (var i = 1; i <= 5; i++) {
        var s = el('span', 'somna-reviews__star' + (i > rating ? ' is-empty' : ''));
        s.innerHTML = this.starSvg; // fixed SVG from the theme template, never sheet content
        wrap.appendChild(s);
      }
      return wrap;
    }

    card(r) {
      var o = this.opts;
      var li = el('li', 'somna-reviews__card');
      var name = r.name ? (o.shortNames ? shortName(r.name) : r.name) : '';

      if (r.avatar) {
        var a = el('img', 'somna-reviews__avatar');
        a.src = r.avatar; a.alt = ''; a.width = 40; a.height = 40; a.loading = 'lazy'; a.decoding = 'async';
        a.addEventListener('error', function () { a.replaceWith(initials(name)); });
        li.appendChild(a);
      } else li.appendChild(initials(name));

      var body = el('div', 'somna-reviews__body');
      if (r.title) body.appendChild(el('h3', 'somna-reviews__title', '“' + r.title + '”'));
      body.appendChild(el('p', 'somna-reviews__text', '“' + r.body + '”'));
      var who = el('p', 'somna-reviews__who');
      if (name) who.appendChild(el('strong', '', name));
      if (o.verified && r.verified) who.appendChild(el('span', 'somna-reviews__verified', this.dataset.verifiedLabel || 'Verified Buyer'));
      var meta = [];
      if (o.product && r.product) meta.push(r.product);
      if (o.dates && r.date) {
        var dt = new Date(r.date);
        meta.push(isNaN(dt) ? r.date : dt.toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
      }
      if (meta.length) who.appendChild(el('span', 'somna-reviews__meta', (who.childNodes.length ? ' · ' : '') + meta.join(' · ')));
      if (who.childNodes.length) body.appendChild(who);
      if (o.photos && r.photo) {
        var p = el('img', 'somna-reviews__photo');
        p.src = r.photo; p.alt = r.title ? 'Customer photo: ' + r.title : 'Customer photo'; p.width = 72; p.height = 72; p.loading = 'lazy'; p.decoding = 'async';
        p.addEventListener('error', function () { p.remove(); });
        body.appendChild(p);
      }
      li.appendChild(body);
      li.appendChild(this.stars(r.rating));
      return li;
    }
  }

  function initials(name) {
    var span = el('span', 'somna-reviews__avatar somna-reviews__avatar--initials', (name || '?').trim().charAt(0) || '?');
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  customElements.define('somna-reviews', SomnaReviews);
})();

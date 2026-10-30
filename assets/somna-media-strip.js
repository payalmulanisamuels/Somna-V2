/**
 * Somna V2 — video strip (sections/somna-media-strip.liquid).
 * - The video file is attached only when a card is played (preload none until then).
 * - Muted start with a speaker button; tapping the video pauses / resumes it.
 * - One video at a time across every strip on the page; pauses when scrolled out of view.
 * - Optional arrows, dots, loop, mouse drag; touch swipe is native scrolling.
 */
(function () {
  if (customElements.get('somna-media-strip')) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function pauseOthers(except) {
    document.querySelectorAll('somna-media-strip video.somna-strip__video').forEach(function (v) {
      if (v !== except && !v.paused) v.pause();
    });
  }

  class SomnaMediaStrip extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      var d = this.dataset;
      this.opt = {
        sound: d.sound === 'true',
        muted: d.startMuted !== 'false',
        controls: d.controls === 'true',
        autoplay: d.autoplay === 'true',
        loop: d.videoLoop === 'true',
        preload: d.preload === 'metadata' ? 'metadata' : 'none',
        oneAtATime: d.oneAtATime !== 'false',
        pauseOffscreen: d.pauseOffscreen !== 'false',
        scrollBy: parseInt(d.scrollBy, 10) || 1,
        loopSlides: d.loop === 'true',
        drag: d.drag === 'true'
      };
      this.track = this.querySelector('[data-track]');
      this.cards = Array.prototype.slice.call(this.querySelectorAll('[data-card]'));
      this.setupVideos();
      this.setupCarousel();
    }

    disconnectedCallback() {
      if (this.io) this.io.disconnect();
      if (this.autoIo) this.autoIo.disconnect();
      this.querySelectorAll('video').forEach(function (v) { v.pause(); });
    }

    /* ---------- videos ---------- */
    setupVideos() {
      var self = this;
      this.cards.forEach(function (card) {
        var video = card.querySelector('video');
        if (!video) return;
        var play = card.querySelector('[data-play]');
        var sound = card.querySelector('[data-sound]');
        video.preload = self.opt.preload;
        if (self.opt.preload === 'metadata') self.attach(video);

        play.addEventListener('click', function () { self.play(card, video); });
        video.addEventListener('click', function (e) {
          if (self.opt.controls) return; // native controls handle clicks
          e.preventDefault();
          if (video.paused) self.play(card, video); else video.pause();
        });
        video.addEventListener('play', function () {
          if (self.opt.oneAtATime) pauseOthers(video);
          card.classList.add('is-playing');
          card.classList.remove('is-loading');
          play.setAttribute('aria-label', self.dataset.pauseLabel || 'Pause video');
        });
        video.addEventListener('playing', function () { card.classList.remove('is-loading'); });
        video.addEventListener('waiting', function () { card.classList.add('is-loading'); });
        video.addEventListener('pause', function () {
          card.classList.remove('is-playing', 'is-loading');
          play.setAttribute('aria-label', play.dataset.label || play.getAttribute('aria-label'));
        });
        video.addEventListener('ended', function () {
          if (!video.loop) {
            card.classList.remove('is-playing');
            video.hidden = true; // back to the poster
            if (sound) sound.hidden = true;
            play.focus({ preventScroll: true });
          }
        });
        video.addEventListener('error', function () {
          card.classList.remove('is-playing', 'is-loading');
          card.classList.add('has-error');
        });
        play.dataset.label = play.getAttribute('aria-label');

        if (sound) sound.addEventListener('click', function () {
          video.muted = !video.muted;
          self.syncSound(sound, video);
        });

        video.addEventListener('keydown', function (e) {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (video.paused) self.play(card, video); else video.pause();
          }
        });
      });

      if (this.opt.pauseOffscreen && 'IntersectionObserver' in window) {
        this.io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting && !en.target.paused) en.target.pause();
          });
        }, { threshold: 0.25 });
        this.querySelectorAll('video').forEach(function (v) { self.io.observe(v); });
      }

      // optional muted autoplay of the first video once the section is on screen
      var first = this.cards.find(function (c) { return c.querySelector('video'); });
      if (this.opt.autoplay && first && !reduce.matches && 'IntersectionObserver' in window) {
        this.autoIo = new IntersectionObserver(function (entries) {
          if (entries.some(function (en) { return en.isIntersecting; })) {
            self.autoIo.disconnect();
            self.play(first, first.querySelector('video'), true);
          }
        }, { threshold: 0.6 });
        this.autoIo.observe(first);
      }

      // pause everything when the tab is hidden or the page is left
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) self.querySelectorAll('video').forEach(function (v) { v.pause(); });
      });
      window.addEventListener('pagehide', function () {
        self.querySelectorAll('video').forEach(function (v) { v.pause(); });
      });
    }

    attach(video) {
      if (video.dataset.attached) return;
      video.dataset.attached = '1';
      (video.dataset.sources || '').split(',').forEach(function (entry) {
        var parts = entry.split('|');
        if (!parts[0]) return;
        var src = document.createElement('source');
        src.src = parts[0].trim();
        if (parts[1]) src.type = parts[1].trim();
        video.appendChild(src);
      });
      video.load();
    }

    play(card, video, auto) {
      if (!video) return;
      this.attach(video);
      video.hidden = false;
      video.loop = this.opt.loop;
      video.controls = this.opt.controls;
      video.muted = auto ? true : (!this.opt.sound || this.opt.muted ? true : video.muted);
      if (!this.opt.sound) video.muted = true;
      if (!video.controls) video.setAttribute('tabindex', '0');
      card.classList.add('is-loading');
      var sound = card.querySelector('[data-sound]');
      if (sound) { sound.hidden = false; this.syncSound(sound, video); }
      var p = video.play();
      if (p && p.catch) p.catch(function () {
        // browser blocked playback with sound: retry muted
        if (!video.muted) { video.muted = true; if (sound) this.syncSound(sound, video); return video.play().catch(function () {}); }
        card.classList.remove('is-loading');
      }.bind(this));
      if (!auto && !video.controls) video.focus({ preventScroll: true });
    }

    syncSound(btn, video) {
      btn.setAttribute('aria-pressed', String(!video.muted));
      btn.setAttribute('aria-label', video.muted ? (this.dataset.unmuteLabel || 'Turn sound on') : (this.dataset.muteLabel || 'Turn sound off'));
    }

    /* ---------- carousel ---------- */
    setupCarousel() {
      var track = this.track;
      if (!track || !track.closest('.is-carousel')) return;
      var self = this;
      var items = Array.prototype.slice.call(track.children);
      var prev = this.querySelector('[data-prev]');
      var next = this.querySelector('[data-next]');
      var dots = this.querySelector('[data-dots]');

      function step() {
        var a = items[0], b = items[1];
        return a && b ? b.offsetLeft - a.offsetLeft : track.clientWidth;
      }
      function atStart() { return track.scrollLeft <= 2; }
      function atEnd() { return track.scrollLeft + track.clientWidth >= track.scrollWidth - 2; }
      function go(dir) {
        var behavior = reduce.matches ? 'auto' : 'smooth';
        if (self.opt.loopSlides && dir > 0 && atEnd()) return track.scrollTo({ left: 0, behavior: behavior });
        if (self.opt.loopSlides && dir < 0 && atStart()) return track.scrollTo({ left: track.scrollWidth, behavior: behavior });
        track.scrollBy({ left: dir * step() * self.opt.scrollBy, behavior: behavior });
      }
      function update() {
        if (prev) prev.disabled = !self.opt.loopSlides && atStart();
        if (next) next.disabled = !self.opt.loopSlides && atEnd();
        if (dots) {
          var i = Math.round(track.scrollLeft / Math.max(1, step()));
          if (atEnd()) i = items.length - 1;
          Array.prototype.forEach.call(dots.children, function (dot, k) {
            if (k === i) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
          });
        }
      }

      if (prev) prev.addEventListener('click', function () { go(-1); });
      if (next) next.addEventListener('click', function () { go(1); });
      if (dots) items.forEach(function (item, k) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'somna-strip__dot';
        dot.setAttribute('aria-label', String(k + 1) + ' / ' + items.length);
        dot.addEventListener('click', function () {
          track.scrollTo({ left: item.offsetLeft - items[0].offsetLeft, behavior: reduce.matches ? 'auto' : 'smooth' });
        });
        dots.appendChild(dot);
      });

      track.addEventListener('keydown', function (e) {
        if (e.target !== track) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      });

      var raf;
      track.addEventListener('scroll', function () {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      }, { passive: true });
      window.addEventListener('resize', update);
      update();

      // mouse drag on desktop (touch keeps native swipe)
      if (this.opt.drag) {
        var startX = 0, startLeft = 0, dragging = false, moved = false;
        track.addEventListener('pointerdown', function (e) {
          if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a, video')) return;
          dragging = true; moved = false;
          startX = e.clientX; startLeft = track.scrollLeft;
        });
        window.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          var dx = e.clientX - startX;
          if (!moved && Math.abs(dx) > 5) { moved = true; track.classList.add('is-dragging'); }
          if (moved) track.scrollLeft = startLeft - dx;
        });
        window.addEventListener('pointerup', function () {
          if (!dragging) return;
          dragging = false;
          if (moved) {
            track.classList.remove('is-dragging');
            // settle on the nearest card
            var s = step();
            track.scrollTo({ left: Math.round(track.scrollLeft / s) * s, behavior: reduce.matches ? 'auto' : 'smooth' });
          }
        });
        track.addEventListener('click', function (e) {
          if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
        }, true);
      }
    }
  }

  customElements.define('somna-media-strip', SomnaMediaStrip);
})();

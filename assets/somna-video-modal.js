/* Somna V2 — "Watch how it works" video popup (PDP steps + homepage steps).
 * A button with data-somna-video-open and aria-controls="<dialog id>" opens that native <dialog>
 * and plays its video from the start. Esc, the backdrop and the X close it; closing pauses the video.
 * Used by sections/somna-pdp-story.liquid and sections/somna-steps.liquid (styles: .somna-video-modal). */
(() => {
  if (window.SomnaVideoModal) return;
  window.SomnaVideoModal = true;

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-somna-video-open]');
    if (opener) {
      const modal = document.getElementById(opener.getAttribute('aria-controls'));
      if (!modal || modal.open) return;
      const video = modal.querySelector('video');
      if (!modal.dataset.somnaBound) {
        modal.dataset.somnaBound = '1';
        modal.addEventListener('close', () => {
          video?.pause();
          opener.focus();
        });
      }
      modal.showModal();
      // the poster is only fetched when the popup opens (it was data-poster until now)
      if (video && video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
      return;
    }
    const modal = e.target.closest('[data-somna-video-modal]');
    if (modal && (e.target === modal || e.target.closest('[data-somna-video-close]'))) modal.close();
  });
})();

import { mountReaction } from '../public/media-view.mjs';
let current;
const root = document.querySelector('#overlay-root');
const clear = () => { current?.destroy(); current = null; root.replaceChildren(); };
window.overlay.onClear(clear);
window.overlay.onVolume(value => current?.setVolume(value));
window.overlay.onShow(event => {
  clear();
  current = mountReaction(root, event, {
    volume: event.volume,
    autoplay: true,
    onReady: () => {
      const view = root.querySelector('.reaction-view');
      if (!view) {
        window.overlay.ready(event.playbackId, null);
        return;
      }
      const mediaEl = view.querySelector('.reaction-media');
      const artEl = view.querySelector('.reaction-art');
      const senderEl = view.querySelector('.reaction-sender');
      const captionEl = view.querySelector('.reaction-caption');

      if (mediaEl) {
        const naturalWidth = mediaEl.naturalWidth || mediaEl.videoWidth || 0;
        const naturalHeight = mediaEl.naturalHeight || mediaEl.videoHeight || 0;

        if (naturalWidth > 0 && naturalHeight > 0) {
          const padX = 16;
          const padY = 16;
          const availWidth = Math.max(80, window.innerWidth - padX);
          const availHeight = Math.max(40, window.innerHeight - padY);

          const hasSender = Boolean(senderEl && !senderEl.hidden && senderEl.textContent.trim());
          const hasCaption = Boolean(captionEl && !captionEl.hidden && captionEl.textContent.trim());
          let itemsCount = 1;
          if (hasSender) itemsCount++;
          if (hasCaption) itemsCount++;
          const totalGaps = (itemsCount - 1) * 8;

          const senderHeight = hasSender ? senderEl.offsetHeight : 0;
          const captionHeight = hasCaption ? captionEl.offsetHeight : 0;
          const otherHeight = senderHeight + captionHeight + totalGaps;

          const maxMediaWidth = availWidth;
          const maxMediaHeight = Math.max(40, availHeight - otherHeight);

          let scale = Math.min(1, maxMediaWidth / naturalWidth, maxMediaHeight / naturalHeight);
          let targetWidth = Math.round(naturalWidth * scale);
          let targetHeight = Math.round(naturalHeight * scale);

          mediaEl.style.width = `${targetWidth}px`;
          mediaEl.style.height = `${targetHeight}px`;
          mediaEl.style.maxWidth = '100%';
          mediaEl.style.maxHeight = '100%';
          mediaEl.style.objectFit = 'contain';

          if (artEl) {
            artEl.style.width = `${targetWidth}px`;
            artEl.style.height = `${targetHeight}px`;
            artEl.style.maxWidth = '100%';
            artEl.style.maxHeight = '100%';
          }

          let viewRect = view.getBoundingClientRect();
          if (viewRect.height > availHeight && targetHeight > 40) {
            const overflow = viewRect.height - availHeight;
            const newMaxHeight = Math.max(40, targetHeight - overflow);
            scale = Math.min(scale, newMaxHeight / naturalHeight);
            targetWidth = Math.round(naturalWidth * scale);
            targetHeight = Math.round(naturalHeight * scale);

            mediaEl.style.width = `${targetWidth}px`;
            mediaEl.style.height = `${targetHeight}px`;
            if (artEl) {
              artEl.style.width = `${targetWidth}px`;
              artEl.style.height = `${targetHeight}px`;
            }
          }
        }
      }

      const rect = view.getBoundingClientRect();
      const size = rect ? { width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : null;
      window.overlay.ready(event.playbackId, size);
    },
    onDone: () => window.overlay.done(event.playbackId),
    onProgress: () => window.overlay.progress(event.playbackId),
    onError: error => {
      console.error('Lecture overlay :', error?.message);
      window.overlay.error('Impossible de lire ce média. Vérifiez le fichier ou sa connexion au serveur.', event.playbackId);
    }
  });
});

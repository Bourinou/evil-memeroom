import { mountReaction } from '../public/media-view.mjs';
let current;
const root = document.querySelector('#overlay-root');
const clear = () => { current?.destroy(); current = null; root.replaceChildren(); };
window.overlay.onClear(clear);
window.overlay.onVolume(value => current?.setVolume(value));
window.overlay.onShow(event => { clear(); current = mountReaction(root, event, { volume: event.volume, autoplay: true, onReady: () => {
  const view = root.querySelector('.reaction-view');
  const rect = view ? view.getBoundingClientRect() : null;
  const size = rect ? { width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : null;
  window.overlay.ready(event.playbackId, size);
}, onDone: () => window.overlay.done(event.playbackId), onProgress: () => window.overlay.progress(event.playbackId), onError: error => { console.error('Lecture overlay :', error?.message); window.overlay.error('Impossible de lire ce média. Vérifiez le fichier ou sa connexion au serveur.', event.playbackId); } }); });

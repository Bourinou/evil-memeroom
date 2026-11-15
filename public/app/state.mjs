import { DEFAULT_SETTINGS, cleanClientState } from '../shared/protocol.mjs';

export const $ = selector => document.querySelector(selector);
export const native = window.memeroom;
if (!native) location.replace('/');
const storageKey = 'memeroom.client.v2';
export const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
function readStorage(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }

// Shared mutable state: modules cannot reassign each other's exported `let` bindings.
export const state = {
  client: cleanClientState(readStorage(storageKey) || {}),
  settings: { ...DEFAULT_SETTINGS }, localServer: location.origin, addresses: [],
  room: null, connection: null, target: null, library: [], visual: null, audio: null, cues: [],
  connected: false, epoch: 0, status: 'Aucune room sélectionnée.',
  mac: false, currentTab: 'composer', messageHistory: []
};

export const SAVED_MIME_TYPES = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg' };
// Long lists are appended a few cards per frame, so opening a tab never blocks the page.
// Starting a new render on the same container cancels the previous one.
const batchRuns = new WeakMap();
export function renderInBatches(container, items, build, size = 12) {
  const run = {}; batchRuns.set(container, run);
  let index = 0;
  const step = () => {
    if (batchRuns.get(container) !== run) return;
    const fragment = document.createDocumentFragment();
    for (const end = Math.min(index + size, items.length); index < end; index++) fragment.append(build(items[index]));
    container.append(fragment);
    if (index < items.length) requestAnimationFrame(step);
  };
  step();
}
// Video thumbnails only start loading once they come near the viewport.
const videoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    videoObserver.unobserve(entry.target);
    entry.target.src = entry.target.dataset.src;
  }
}, { rootMargin: '300px' });
export function lazyVideo(video, src) { video.preload = 'metadata'; video.dataset.src = src; videoObserver.observe(video); }
export const keyFor = value => value ? `${value.server}|${value.code}` : '';
export const resolveServer = ref => ref === 'local' ? state.localServer : ref;
export function referenceFor(url) {
  const parsed = new URL(url), local = new URL(state.localServer);
  return parsed.port === local.port && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) ? 'local' : url;
}
let toastTimer;
export function notify(message, error = false) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6000 : 3500);
}
export async function saveClient() {
  state.client = cleanClientState(state.client);
  try {
    await native.saveClient(state.client);
  } catch { notify('Impossible d’enregistrer les rooms sur cet appareil.', true); return false; }
  return true;
}

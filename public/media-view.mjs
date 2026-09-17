import { hasTimedMedia, LIMITS, cleanText, applyReactionMeta } from '../shared/protocol.mjs';

export function mountReaction(container, reaction, { volume = 0, autoplay = false, still = false, onReady = () => {}, onDone = () => {}, onError = () => {}, onProgress = () => {} } = {}) {
  applyReactionMeta(reaction);
  const root = document.createElement('div'); root.className = 'reaction-view'; root.hidden = autoplay;
  const players = [], visuals = [], urls = [], abort = new AbortController();
  let mutedVideo, timer, watchdog, animation, dead = false, completed = false, startedAt;
  const stop = () => { clearTimeout(timer); clearInterval(watchdog); cancelAnimationFrame(animation); for (const player of players) player.pause(); };
  const finish = () => { if (dead || completed) return; completed = true; stop(); onDone(); };
  const fail = error => { if (dead || completed) return; completed = true; stop(); abort.abort(); onError(error); };
  const sender = cleanText(typeof reaction.sender === 'string' ? reaction.sender : reaction.sender?.name, 24);
  if (sender) { const label = document.createElement('div'); label.className = 'reaction-sender'; label.textContent = sender; root.append(label); }
  if (reaction.media) {
    const art = document.createElement('div'); art.className = 'reaction-art';
    const visual = document.createElement(reaction.media.kind === 'video' ? 'video' : 'img'); visual.className = 'reaction-media';
    if (reaction.media.kind === 'video') {
      visual.playsInline = true; visual.preload = still ? 'metadata' : 'auto';
      if (reaction.audio) mutedVideo = visual;
      visual.muted = visual === mutedVideo || volume === 0; visual.volume = volume / 100; players.push(visual);
    } else visual.alt = reaction.media.name;
    visuals.push([visual, reaction.media]); art.append(visual); root.append(art);
  }
  const caption = document.createElement('div'); caption.className = 'reaction-caption'; caption.textContent = reaction.caption || ''; caption.hidden = !reaction.caption; root.append(caption);
  if (reaction.audio && !still) {
    const audio = document.createElement('audio'); audio.preload = 'auto'; audio.volume = volume / 100;
    players.push(audio); visuals.push([audio, reaction.audio]); root.append(audio);
  }
  container.replaceChildren(root);

  async function prepare(element, asset) {
    let url = asset.playbackURL || new URL(asset.url, reaction.server).href;
    // Overlay file URLs are supplied by the main process after a complete download.
    if (autoplay && !asset.playbackURL) {
      let response;
      try {
        response = await fetch(url, { signal:AbortSignal.any([abort.signal, AbortSignal.timeout(LIMITS.transferTimeoutMs)]) });
      } catch {}
      if (!response || !response.ok) {
        if (asset.name) {
          try {
            const fallbackResp = await fetch(`/saved-memes/${encodeURIComponent(asset.name)}`, { signal:AbortSignal.any([abort.signal, AbortSignal.timeout(LIMITS.transferTimeoutMs)]) });
            if (fallbackResp.ok) response = fallbackResp;
          } catch {}
        }
      }
      if (!response || !response.ok) throw new Error('Fichier indisponible ou expiré.');
      if (Number(response.headers.get('content-length')) > LIMITS.uploadBytes) { await response.body.cancel(); throw new Error('Fichier trop volumineux.'); }
      const blob = await response.blob();
      if (dead || completed) return;
      if (blob.size > LIMITS.uploadBytes) throw new Error('Fichier trop volumineux.');
      url = URL.createObjectURL(blob); urls.push(url);
    }
    if (dead || completed) return;
    await new Promise((resolve, reject) => {
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Fichier image, vidéo ou audio illisible.')); };
      const cleanup = () => { clearTimeout(timeout); element.removeEventListener('load',loaded); element.removeEventListener('loadeddata',loaded); element.removeEventListener('loadedmetadata',loaded); element.removeEventListener('error',failed); abort.signal.removeEventListener('abort',failed); };
      const timeout = setTimeout(failed, 60000);
      element.addEventListener(element.tagName === 'IMG' ? 'load' : still ? 'loadedmetadata' : 'loadeddata', loaded, { once:true });
      element.addEventListener('error', failed, { once:true }); abort.signal.addEventListener('abort', failed, { once:true });
      element.src = url;
    });
    if (element.tagName === 'IMG' && element.decode) await element.decode();
    element.addEventListener('error', () => fail(new Error('La lecture a échoué.')));
  }
  async function start() {
    await Promise.all(visuals.map(([element, asset]) => prepare(element, asset)));
    if (dead || completed || !autoplay) return;
    startedAt = performance.now();
    await Promise.all(players.map(player => player.play()));
    if (dead || completed) return;
    root.hidden = false; onReady();
    const automatic = hasTimedMedia(reaction) && reaction.durationMode !== 'fixed' && !reaction.customDuration && players.length > 0;
    if (automatic) {
      const progress = new Map(players.map(player => [player, { time:player.currentTime, at:performance.now() }]));
      const checkEnded = () => { if (players.every(player => player.ended)) finish(); };
      for (const player of players) player.addEventListener('ended', checkEnded);
      watchdog = setInterval(() => {
        const now = performance.now(); let advanced = false;
        for (const player of players) {
          if (player.ended) continue;
          const previous = progress.get(player);
          if (player.currentTime !== previous.time) { previous.time = player.currentTime; previous.at = now; advanced = true; }
          else if (now - previous.at >= LIMITS.playbackStallMs) { fail(new Error('La lecture du média est bloquée.')); return; }
        }
        if (advanced) onProgress(); checkEnded();
      }, 1000);
      checkEnded();
    } else {
      timer = setTimeout(finish, reaction.duration * 1000);
    }
    if (reaction.subtitles?.length) {
      let currentText = caption.textContent;
      const tick = () => {
        if (dead || completed) return;
        const elapsed = players.length ? Math.max(...players.map(player => player.currentTime)) : (performance.now() - startedAt) / 1000;
        const cue = reaction.subtitles.find(c => elapsed >= c.start && elapsed < c.end);
        const text = cue?.text || reaction.caption || '';
        if (text !== currentText) {
          currentText = text;
          caption.textContent = text;
          caption.hidden = !text;
        }
        animation = requestAnimationFrame(tick);
      };
      tick();
    }
  }
  void start().catch(fail);
  return {
    setVolume(value) { volume = value; for (const player of players) { player.volume = Math.max(0, Math.min(1, value / 100)); player.muted = player === mutedVideo || value === 0; } },
    destroy() {
      dead = true; abort.abort(); stop();
      for (const [element] of visuals) { element.removeAttribute('src'); if (players.includes(element)) element.load(); }
      for (const url of urls) URL.revokeObjectURL(url);
      root.remove();
    }
  };
}

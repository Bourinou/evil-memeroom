import { LIMITS } from '../shared/protocol.mjs';
import { $, native, state, notify, resolveServer } from './state.mjs';
import { renderSend, renderAttachments } from './composer.mjs';
import { uploadMedia } from './upload.mjs';
import { renderLibrary } from './rooms.mjs';

let trimAsset = null, trimTarget = null;
let trimTotalDuration = 0;
let trimStart = 0;
let trimEnd = 0;

function updateTrimUI() {
  $('#trim-start-display').textContent = `Début : ${trimStart.toFixed(1)}s`;
  $('#trim-duration-display').textContent = `Durée : ${(trimEnd - trimStart).toFixed(1)}s`;
  $('#trim-end-display').textContent = `Fin : ${trimEnd.toFixed(1)}s`;
  const startPct = trimTotalDuration > 0 ? (trimStart / trimTotalDuration) * 100 : 0;
  const endPct = trimTotalDuration > 0 ? (trimEnd / trimTotalDuration) * 100 : 100;
  $('#trim-selection').style.left = `${startPct}%`;
  $('#trim-selection').style.width = `${Math.max(0, endPct - startPct)}%`;
  $('#trim-handle-start').style.left = `${startPct}%`;
  $('#trim-handle-end').style.left = `calc(${endPct}% - 16px)`;
}

function updateTrimPlayhead(time) {
  const pct = trimTotalDuration > 0 ? (time / trimTotalDuration) * 100 : 0;
  const playhead = $('#trim-playhead');
  playhead.style.left = `${pct}%`;
  playhead.style.display = 'block';
}

function setupHandleDrag(handle, onMove) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    const track = $('#trim-track');
    handle.setPointerCapture(e.pointerId);
    const pointerMove = moveEvent => {
      const trackRect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(trackRect.width, moveEvent.clientX - trackRect.left));
      const ratio = trackRect.width > 0 ? x / trackRect.width : 0;
      const time = ratio * trimTotalDuration;
      onMove(time);
      updateTrimUI();
    };
    const pointerUp = () => {
      handle.removeEventListener('pointermove', pointerMove);
      handle.removeEventListener('pointerup', pointerUp);
      handle.removeEventListener('pointercancel', pointerUp);
    };
    handle.addEventListener('pointermove', pointerMove);
    handle.addEventListener('pointerup', pointerUp);
    handle.addEventListener('pointercancel', pointerUp);
  });
}

setupHandleDrag($('#trim-handle-start'), time => {
  trimStart = Math.max(0, Math.min(trimEnd - 0.1, time));
  const media = trimAsset?.kind === 'video' ? $('#trim-video') : $('#trim-audio');
  media.currentTime = trimStart;
  updateTrimPlayhead(trimStart);
});

setupHandleDrag($('#trim-handle-end'), time => {
  trimEnd = Math.min(trimTotalDuration, Math.max(trimStart + 0.1, time));
  const media = trimAsset?.kind === 'video' ? $('#trim-video') : $('#trim-audio');
  media.currentTime = trimEnd;
  updateTrimPlayhead(trimEnd);
});

$('#trim-track').addEventListener('pointerdown', e => {
  if (e.target === $('#trim-handle-start') || e.target === $('#trim-handle-end')) return;
  const trackRect = $('#trim-track').getBoundingClientRect();
  const x = Math.max(0, Math.min(trackRect.width, e.clientX - trackRect.left));
  const ratio = trackRect.width > 0 ? x / trackRect.width : 0;
  const time = ratio * trimTotalDuration;
  const media = trimAsset?.kind === 'video' ? $('#trim-video') : $('#trim-audio');
  media.currentTime = time;
  updateTrimPlayhead(time);
});

function onTrimTimeUpdate(media) {
  if (media.currentTime >= trimEnd) {
    media.pause();
    media.currentTime = trimStart;
    $('#trim-play-pause').textContent = '▶ Lecture';
  }
  updateTrimPlayhead(media.currentTime);
}

$('#trim-video').addEventListener('timeupdate', () => onTrimTimeUpdate($('#trim-video')));
$('#trim-audio').addEventListener('timeupdate', () => onTrimTimeUpdate($('#trim-audio')));

$('#trim-play-pause').addEventListener('click', () => {
  const media = trimAsset?.kind === 'video' ? $('#trim-video') : $('#trim-audio');
  if (media.paused) {
    if (media.currentTime < trimStart || media.currentTime >= trimEnd) {
      media.currentTime = trimStart;
    }
    media.play().then(() => {
      $('#trim-play-pause').textContent = '⏸ Pause';
    }).catch(() => {});
  } else {
    media.pause();
    $('#trim-play-pause').textContent = '▶ Lecture';
  }
});

async function drawTrimVisualizer(asset, mediaUrl, duration) {
  const canvas = $('#trim-canvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.parentElement.clientWidth || 600;
  canvas.width = width;
  canvas.height = 50;
  ctx.clearRect(0, 0, width, 50);

  if (asset.kind === 'video') {
    ctx.fillStyle = '#1e2330';
    ctx.fillRect(0, 0, width, 50);
    try {
      const offscreen = document.createElement('video');
      offscreen.muted = true;
      offscreen.playsInline = true;
      offscreen.crossOrigin = 'anonymous';
      offscreen.src = mediaUrl;
      await new Promise(resolve => {
        offscreen.onloadeddata = resolve;
        offscreen.onerror = resolve;
        setTimeout(resolve, 2500);
      });
      const frameCount = Math.max(6, Math.min(12, Math.floor(width / 60)));
      const frameWidth = width / frameCount;
      for (let i = 0; i < frameCount; i++) {
        if (trimAsset !== asset) return;
        const targetTime = (i / (frameCount - 1 || 1)) * Math.max(0.1, duration - 0.1);
        offscreen.currentTime = targetTime;
        await new Promise(res => {
          const onSeek = () => { offscreen.removeEventListener('seeked', onSeek); res(); };
          offscreen.addEventListener('seeked', onSeek);
          setTimeout(res, 250);
        });
        ctx.drawImage(offscreen, i * frameWidth, 0, frameWidth, 50);
      }
    } catch {}
  } else if (asset.kind === 'audio') {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      try {
        const resp = await fetch(mediaUrl);
        const buf = await resp.arrayBuffer();
        const audioBuf = await audioCtx.decodeAudioData(buf);
        if (trimAsset !== asset) return;
        const rawData = audioBuf.getChannelData(0);
        const step = Math.ceil(rawData.length / width);
        const amp = 25;
        ctx.fillStyle = '#ef4444';
        for (let i = 0; i < width; i++) {
          let min = 1.0;
          let max = -1.0;
          for (let j = 0; j < step; j++) {
            const datum = rawData[i * step + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }
          const y = (1 + min) * amp;
          const h = Math.max(2, (max - min) * amp);
          ctx.fillRect(i, y, 1, h);
        }
      } finally {
        audioCtx.close().catch(() => {});
      }
    } catch {}
  }
}

export function openTrimDialog(asset) {
  trimAsset = asset;
  trimTarget = (asset === state.audio) ? 'audio' : 'visual';
  trimStart = 0;
  trimEnd = 0;
  trimTotalDuration = 0;
  $('#trim-title').textContent = `Découper · ${asset.name}`;
  $('#trim-apply').disabled = true;
  $('#trim-apply').textContent = 'Appliquer le trim';
  $('#trim-play-pause').textContent = '▶ Lecture';
  $('#trim-playhead').style.display = 'none';

  const mediaUrl = new URL(asset.url, resolveServer(state.target.server)).href;
  const video = $('#trim-video');
  const audioEl = $('#trim-audio');
  video.pause(); video.removeAttribute('src'); video.load();
  audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();

  const media = asset.kind === 'video' ? video : audioEl;
  video.style.display = asset.kind === 'video' ? 'block' : 'none';
  audioEl.style.display = 'none';

  const onLoaded = () => {
    media.removeEventListener('loadedmetadata', onLoaded);
    trimTotalDuration = media.duration || 5;
    trimStart = 0;
    trimEnd = trimTotalDuration;
    $('#trim-apply').disabled = false;
    updateTrimUI();
    drawTrimVisualizer(asset, mediaUrl, trimTotalDuration);
  };
  media.addEventListener('loadedmetadata', onLoaded);
  media.src = mediaUrl;
  media.load();
  $('#trim-dialog').showModal();
}

$('#trim-dialog').addEventListener('close', () => {
  const v = $('#trim-video');
  const a = $('#trim-audio');
  v.pause(); v.removeAttribute('src'); v.load();
  a.pause(); a.removeAttribute('src'); a.load();
  trimAsset = null;
  trimTarget = null;
});

$('#trim-apply').addEventListener('click', async () => {
  if (!trimAsset || trimEnd <= trimStart) return;
  const applyBtn = $('#trim-apply');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Découpe en cours…';
  try {
    const mediaUrl = new URL(trimAsset.url, resolveServer(state.target.server)).href;
    const resp = await fetch(mediaUrl);
    const arrayBuf = await resp.arrayBuffer();
    const trimmed = await native.trimMedia({
      name: trimAsset.name,
      buffer: new Uint8Array(arrayBuf),
      start: trimStart,
      end: trimEnd,
      asAudio: trimTarget === 'audio'
    });
    const mime = trimmed.mime || (trimTarget === 'audio' ? (trimmed.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg') : (trimAsset.mime || (trimAsset.kind === 'video' ? (trimmed.name.endsWith('.webm') ? 'video/webm' : 'video/mp4') : (trimmed.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'))));
    const blob = new Blob([trimmed.buffer], { type: mime });
    const trimmedFile = new File([blob], trimmed.name, { type: mime });

    if (trimmedFile.size > LIMITS.uploadBytes) throw new Error(`${trimmedFile.name} dépasse 1 Go.`);
    const uploaded = await uploadMedia(trimmedFile, state.epoch, state.room);
    uploaded.isTrimmed = true;
    if (!state.library.some(a => a.id === uploaded.id)) state.library.push(uploaded);
    if (trimTarget === 'visual') state.visual = uploaded;
    else state.audio = uploaded;
    const durationToggle = $('#custom-duration-toggle');
    if (durationToggle) durationToggle.checked = false;
    const durationInput = $('#duration');
    if (durationInput) durationInput.value = '';
    renderSend();
    renderLibrary();
    renderAttachments();
    $('#trim-dialog').close();
    notify('Média découpé avec succès.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Appliquer le trim';
  }
});

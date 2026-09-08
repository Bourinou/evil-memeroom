export const LIMITS = Object.freeze({
  uploadBytes: 1024 ** 3,
  roomBytes: 2 * 1024 ** 3,
  totalBytes: 8 * 1024 ** 3,
  mediaTtlMs: 10 * 60 * 1000,
  transferTimeoutMs: 30 * 60 * 1000,
  durationMin: 2,
  durationMax: 15,
  playbackStallMs: 30000,
  cooldownMs: 3000,
  members: 16,
  mediaCount: 30,
});

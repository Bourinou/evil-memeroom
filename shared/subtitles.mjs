import { cleanText } from './text.mjs';

export function parseSubtitles(input) {
  if (typeof input !== 'string' || input.length > 32000)
    throw new Error('Sous-titres trop volumineux (32 Ko maximum).');
  const stamp = '(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{3})';
  const re = new RegExp(`^${stamp}\\s*-->\\s*${stamp}`);
  const cues = [];
  for (const block of input.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const i = lines.findIndex((line) => re.test(line));
    if (i < 0) continue;
    const m = lines[i].match(re);
    const time = (j) =>
      Number(m[j]) * 3600 + Number(m[j + 1]) * 60 + Number(m[j + 2]) + Number(m[j + 3]) / 1000;
    const start = time(1),
      end = time(5);
    const text = cleanText(
      lines
        .slice(i + 1)
        .join('\n')
        .replace(/<[^>]*>/g, ''),
      300,
    );
    if (end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start).slice(0, 80);
}

export function validCues(cues) {
  if (!Array.isArray(cues)) return [];
  return cues
    .slice(0, 80)
    .filter(
      (c) =>
        c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start,
    )
    .map((c) => ({ start: c.start, end: c.end, text: cleanText(c.text, 300) }));
}

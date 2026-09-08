/** @type {Readonly<import('./contracts.js').Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  paused: false,
  volume: 45,
  size: 60,
  cooldown: 5,
  position: 'center',
  display: 'primary',
  dismissShortcut: 'Control+Shift+F9',
});

export function validDismissShortcut(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 80 || value === 'Control+Shift+F8') return false;
  const parts = value.split('+'),
    key = parts.pop();
  return (
    parts.join('+') ===
      ['Control', 'Alt', 'Shift', 'Super'].filter((part) => parts.includes(part)).join('+') &&
    /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/.test(
      key,
    ) &&
    (/^F\d+$/.test(key) || parts.some((part) => ['Control', 'Alt', 'Super'].includes(part)))
  );
}

/** @returns {import('./contracts.js').Settings} */
export function cleanSettings(input = {}) {
  const number = (key, min, max) =>
    Number.isFinite(Number(input[key]))
      ? Math.max(min, Math.min(max, Number(input[key])))
      : DEFAULT_SETTINGS[key];
  return {
    paused: input.paused === true,
    volume: number('volume', 0, 100),
    size: number('size', 20, 60),
    cooldown: number('cooldown', 3, 60),
    position: ['bottom-right', 'bottom-left', 'center', 'top-right'].includes(input.position)
      ? input.position
      : DEFAULT_SETTINGS.position,
    display: typeof input.display === 'string' ? input.display.slice(0, 50) : 'primary',
    dismissShortcut: validDismissShortcut(input.dismissShortcut)
      ? input.dismissShortcut
      : DEFAULT_SETTINGS.dismissShortcut,
  };
}

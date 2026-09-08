export const $ = (selector) => document.querySelector(selector);
export const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
export function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

let toastTimer;
export function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      toast.hidden = true;
    },
    error ? 6000 : 3500,
  );
}

export function bindDialogs() {
  for (const button of document.querySelectorAll('button[data-close]')) {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.getAttribute('data-close'));
      if (dialog instanceof HTMLDialogElement) dialog.close();
    });
  }
  for (const dialog of document.querySelectorAll('dialog')) {
    let outsideDown = false;
    const outside = (event) => {
      const r = dialog.getBoundingClientRect();
      return (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      );
    };
    dialog.addEventListener('pointerdown', (event) => {
      outsideDown = event.target === dialog && outside(event);
    });
    dialog.addEventListener('click', (event) => {
      if (outsideDown && event.target === dialog && outside(event)) dialog.close();
      outsideDown = false;
    });
  }
}

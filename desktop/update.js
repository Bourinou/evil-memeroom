const status = document.getElementById('status');
const progress = document.getElementById('progress');
const skip = document.getElementById('skip');
skip.addEventListener('click', () => window.memeroomUpdate.skip());
window.memeroomUpdate.onStatus((value) => {
  if (value.phase === 'checking') status.textContent = 'Recherche de mises à jour…';
  if (value.phase === 'downloading') {
    status.textContent = `Mise à jour · ${value.percent} %`;
    progress.hidden = false;
    progress.value = value.percent;
  }
  if (value.phase === 'installing') {
    status.textContent = 'Installation et redémarrage…';
    skip.disabled = true;
  }
});

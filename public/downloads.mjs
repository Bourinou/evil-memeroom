try {
  const response = await fetch('/api/downloads');
  if (!response.ok)
    throw new Error('Téléchargements momentanément indisponibles. Réessayez plus tard.');
  const downloads = await response.json();
  for (const platform of ['windows', 'linux', 'macArm64', 'macIntel']) {
    const item = downloads[platform];
    const link = document.getElementById(`${platform}-download`);
    const info = document.getElementById(`${platform}-info`);
    if (!item) {
      info.textContent = 'Bientôt disponible';
      continue;
    }
    if (!/^\/releases\/MemeRoom-[A-Za-z0-9._-]+$/.test(item.url))
      throw new Error('Lien de téléchargement invalide.');
    link.href = item.url;
    link.setAttribute('download', '');
    link.removeAttribute('aria-disabled');
    info.textContent = `Version ${item.version} · ${Math.round(item.bytes / 1024 / 1024)} Mo`;
  }
} catch (error) {
  document.getElementById('download-status').textContent = error.message;
  for (const item of document.querySelectorAll('[id$="-info"]')) item.textContent = 'Indisponible';
}

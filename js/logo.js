// Logo element with graceful fallback: if the image is missing or fails to
// load, swap in a typographic title card so the UI never shows a broken image.
export function makeLogo(movie) {
  const img = document.createElement('img');
  img.src = movie.logo;
  img.alt = movie.title;
  img.loading = 'lazy';
  img.draggable = false;
  img.addEventListener('error', () => {
    const text = document.createElement('div');
    text.className = 'text-logo';
    text.textContent = movie.title;
    img.replaceWith(text);
  });
  return img;
}

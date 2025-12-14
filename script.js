/* script.js
   Reads metadata (title, artist, cover) using jsmediatags and updates the UI.
   The UI stays hidden until metadata read completes (success or failure).
   Cover is taken from the audio file and kept static unless user picks a new file.
*/

const audio = document.getElementById('audio');
const fileInput = document.getElementById('file-input');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const coverImg = document.querySelector('.img-container img');
const container = document.getElementById('player-container');
const spinnerWrapper = document.getElementById('spinner-wrapper');

// Helper to convert picture object from jsmediatags to data URL
function pictureToDataURL(picture) {
  if (!picture || !picture.data) return null;
  const byteArray = picture.data;
  let binary = '';
  for (let i = 0; i < byteArray.length; i++) {
    binary += String.fromCharCode(byteArray[i]);
  }
  const base64 = btoa(binary);
  return `data:${picture.format};base64,${base64}`;
}

// Set UI fields; when called we populate the UI but do not autoplay anything.
// options.setCover: whether to overwrite the cover image
function setMetadata({ title, artist, picture } = {}, options = { setCover: true }) {
  // Only set provided values; if undefined leave as-is.
  titleEl.textContent = title || titleEl.textContent || '';
  artistEl.textContent = artist || artistEl.textContent || '';
  if (options.setCover && picture) {
    const dataUrl = pictureToDataURL(picture);
    if (dataUrl) coverImg.src = dataUrl;
  }
}

// fallback filename extraction
function getFilenameFromSrc(src) {
  if (!src) return '';
  try {
    const url = new URL(src, location.href);
    return decodeURIComponent(url.pathname.split('/').pop());
  } catch (e) {
    return src.split('/').pop();
  }
}

// Try to read tags from a URL (may fail on GitHub Pages due to CORS)
function readTagsFromUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      new jsmediatags.Reader(url)
        .setTagsToRead(['title', 'artist', 'picture'])
        .read({
          onSuccess: function(tag) {
            resolve(tag.tags);
          },
          onError: function(error) {
            reject(error);
          }
        });
    } catch (err) {
      reject(err);
    }
  });
}

// Read tags from a File object (preferred when user picks local file)
function readTagsFromFile(file) {
  return new Promise((resolve, reject) => {
    try {
      jsmediatags.read(file, {
        onSuccess: function(tag) {
          resolve(tag.tags);
        },
        onError: function(err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Reveal UI (remove loading state)
function revealUI() {
  container.classList.remove('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = 'none';
}

// Initialize: try to read metadata for audio.src (default file). Keep UI hidden until done.
async function init() {
  // Ensure UI is in loading state
  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';

  // If audio has a src attribute, attempt to read tags via URL Reader
  const urlAttr = audio.getAttribute('src');
  const url = urlAttr || audio.src;
  if (url) {
    const absoluteUrl = new URL(url, location.href).href;
    try {
      const tags = await readTagsFromUrl(absoluteUrl);
      setMetadata(tags, { setCover: true });
      // If title/artist missing, fallback to filename for title only
      if (!tags.title) titleEl.textContent = getFilenameFromSrc(absoluteUrl);
    } catch (err) {
      // Could not read tags from URL (likely CORS). Use filename fallback.
      titleEl.textContent = getFilenameFromSrc(absoluteUrl) || '';
      artistEl.textContent = '';
      console.warn('Could not read tags from URL (CORS or not accessible). Fallback to filename.', err);
    } finally {
      // Reveal UI regardless of success or failure
      revealUI();
    }
  } else {
    // No src configured; just reveal empty UI so user can pick a file
    revealUI();
  }
}

// Handle user selecting a file (prefer reading tags from File object)
fileInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const file = files[0];

  // Keep UI in loading while reading file tags
  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';

  // point audio to the selected file (object URL) but do not play it
  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.load();

  try {
    const tags = await readTagsFromFile(file);
    // Update title/artist/cover (cover will overwrite previous)
    setMetadata(tags, { setCover: true });
    if (!tags.title) titleEl.textContent = file.name;
    if (!tags.artist) artistEl.textContent = '';
  } catch (err) {
    // If reading tags fails, fallback to filename
    titleEl.textContent = file.name;
    artistEl.textContent = '';
    console.warn('Could not read tags from selected file.', err);
  } finally {
    revealUI();
  }
});

// Kick off initial load
init();

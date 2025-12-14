/* script.js
   Reads metadata (title, artist, cover) using jsmediatags and updates the UI.
   Cover is taken from the audio file and kept static unless user picks a new file.
*/

const audio = document.getElementById('audio');
const fileInput = document.getElementById('file-input');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const coverImg = document.querySelector('.img-container img');

// Helper to convert picture object from jsmediatags to data URL
function pictureToDataURL(picture) {
  if (!picture || !picture.data) return null;
  const byteArray = picture.data;
  let binary = '';
  // build binary string (this is fine for typical cover sizes)
  for (let i = 0; i < byteArray.length; i++) {
    binary += String.fromCharCode(byteArray[i]);
  }
  const base64 = btoa(binary);
  return `data:${picture.format};base64,${base64}`;
}

// Set UI fields; keep cover static (won't overwrite unless coverArg passed and user changed file)
function setMetadata({ title, artist, picture }, options = { setCover: true }) {
  titleEl.textContent = title || titleEl.textContent || getFilenameFromSrc(audio.src) || 'Unknown';
  artistEl.textContent = artist || artistEl.textContent || 'Unknown';
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
    return url.pathname.split('/').pop();
  } catch (e) {
    return src.split('/').pop();
  }
}

// Try to read tags from a URL (this may fail if server/CORS doesn't allow access)
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

// Initialize: try to read metadata for audio.src (default file). If it fails, fall back to filename.
async function init() {
  // If audio has a src and it's not an object URL, attempt to read tags via URL Reader
  if (audio.src) {
    const url = audio.getAttribute('src') || audio.src;
    // build absolute URL relative to page so Reader can fetch it
    const absoluteUrl = new URL(url, location.href).href;
    try {
      const tags = await readTagsFromUrl(absoluteUrl);
      setMetadata(tags, { setCover: true });
    } catch (err) {
      // Can't read tags from URL (likely CORS); use filename fallback
      titleEl.textContent = getFilenameFromSrc(absoluteUrl);
      console.warn('Could not read tags from URL (CORS or not accessible). Fallback to filename.', err);
    }
  }
}

// Handle user selecting a file (prefer reading tags from File object)
fileInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const file = files[0];

  // point audio to the selected file
  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.load();

  try {
    const tags = await readTagsFromFile(file);
    // When user explicitly picks a file, update cover/title/artist (cover will overwrite previous)
    setMetadata(tags, { setCover: true });
  } catch (err) {
    // If reading tags fails, fallback to filename
    titleEl.textContent = file.name;
    artistEl.textContent = 'Unknown';
    console.warn('Could not read tags from selected file.', err);
  }
});

// If you have UI that programmatically changes tracks, ensure you only call setMetadata when you want to change title/cover.
// This preserves a "static" cover behaviour: it will not change unless a new file is explicitly loaded or metadata read is triggered.

// Kick off initial load
init();

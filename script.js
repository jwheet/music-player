/* script.js
   Metadata reading (jsmediatags) + static cover behavior + play/pause + progress UI.
   - UI hidden while metadata loads (as before)
   - Play/pause toggles audio.play()/audio.pause(), updates icon
   - Progress bar and time display updated on timeupdate; clicking progress seeks
   - No autoplay; play only after explicit user click
*/

const audio = document.getElementById('audio');
const fileInput = document.getElementById('file-input');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const coverImg = document.querySelector('.img-container img');
const container = document.getElementById('player-container');
const spinnerWrapper = document.getElementById('spinner-wrapper');

const playBtn = document.getElementById('play');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const progressContainer = document.getElementById('progress-container');
const progressEl = document.getElementById('progress');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');

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
  titleEl.textContent = title || titleEl.textContent || '';
  artistEl.textContent = artist || artistEl.textContent || '';
  if (options.setCover && picture) {
    const dataUrl = pictureToDataURL(picture);
    if (dataUrl) {
      coverImg.src = dataUrl;
      coverImg.style.visibility = 'visible';
    }
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

// A timeout wrapper so readTagsFromUrl can't hang forever
function readTagsFromUrlWithTimeout(url, timeoutMs = 3500) {
  return Promise.race([
    readTagsFromUrl(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('tag-read-timeout')), timeoutMs))
  ]);
}

// Format seconds -> M:SS
function formatTime(seconds = 0) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Update progress UI from audio.currentTime / duration
function updateProgressUI() {
  const cur = audio.currentTime || 0;
  const dur = audio.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  progressEl.style.width = `${pct}%`;
  currentTimeEl.textContent = formatTime(cur);
  durationEl.textContent = dur ? formatTime(dur) : '0:00';
}

// Seek when user clicks progress container
function handleProgressClick(e) {
  const rect = progressContainer.getBoundingClientRect();
  const x = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  if (audio.duration) {
    audio.currentTime = pct * audio.duration;
  }
}

// Toggle play/pause and update icon
function togglePlay() {
  if (!audio.src) {
    // no audio source set
    console.warn('No audio source to play.');
    return;
  }
  if (audio.paused) {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // play started
        playBtn.classList.remove('fa-play');
        playBtn.classList.add('fa-pause');
      }).catch((err) => {
        // play failed (shouldn't happen when triggered by click) — log
        console.warn('Play failed:', err);
      });
    } else {
      // older browsers
      playBtn.classList.remove('fa-play');
      playBtn.classList.add('fa-pause');
    }
  } else {
    audio.pause();
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  }
}

// Ensure play button icon matches current state
function syncPlayButtonIcon() {
  if (audio.paused) {
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  } else {
    playBtn.classList.remove('fa-play');
    playBtn.classList.add('fa-pause');
  }
}

// Initialize: try to read metadata for audio.src (default file). Keep UI hidden until done.
async function init() {
  // Put UI into loading state and hide text + art until we finish
  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';
  titleEl.textContent = '';
  artistEl.textContent = '';
  coverImg.style.visibility = 'hidden';

  // Attach event listeners for playback/progress
  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    togglePlay();
  });
  // prev/next are placeholders for now (no playlist implemented)
  if (prevBtn) prevBtn.addEventListener('click', () => { audio.currentTime = 0; });
  if (nextBtn) nextBtn.addEventListener('click', () => { audio.currentTime = 0; });

  audio.addEventListener('timeupdate', updateProgressUI);
  audio.addEventListener('loadedmetadata', updateProgressUI);
  audio.addEventListener('play', syncPlayButtonIcon);
  audio.addEventListener('pause', syncPlayButtonIcon);
  audio.addEventListener('ended', () => {
    // on end, show play icon
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  });

  if (progressContainer) {
    progressContainer.addEventListener('click', handleProgressClick);
    // support touch seeking
    progressContainer.addEventListener('touchstart', (e) => {
      handleProgressClick(e);
      e.preventDefault();
    }, { passive: false });
  }

  // If audio has a src attribute, attempt to read tags via URL Reader
  const urlAttr = audio.getAttribute('src');
  const url = urlAttr || audio.src;
  if (url) {
    const absoluteUrl = new URL(url, location.href).href;
    try {
      const tags = await readTagsFromUrlWithTimeout(absoluteUrl, 3500);
      setMetadata(tags, { setCover: true });
      if (!tags.title) titleEl.textContent = getFilenameFromSrc(absoluteUrl);
      if (!tags.picture) coverImg.style.visibility = 'hidden';
    } catch (err) {
      // Timeout or other failure: show filename as title and no cover (still hidden)
      titleEl.textContent = getFilenameFromSrc(absoluteUrl) || '';
      artistEl.textContent = '';
      console.warn('Could not read tags from URL (CORS, timeout or not accessible). Fallback to filename.', err);
    } finally {
      revealUI();
      // sync play icon in case audio is paused (most likely)
      syncPlayButtonIcon();
    }
  } else {
    // No src configured; just reveal empty UI so user can pick a file
    revealUI();
    syncPlayButtonIcon();
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
  titleEl.textContent = '';
  artistEl.textContent = '';
  coverImg.style.visibility = 'hidden';

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
    if (!tags.picture) coverImg.style.visibility = 'hidden';
  } catch (err) {
    // If reading tags fails, fallback to filename; keep no cover
    titleEl.textContent = file.name;
    artistEl.textContent = '';
    coverImg.style.visibility = 'hidden';
    console.warn('Could not read tags from selected file.', err);
  } finally {
    revealUI();
    syncPlayButtonIcon();
  }
});

// Kick off initial load
init();

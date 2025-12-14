/* script.js
   Metadata reading (jsmediatags) + static cover behavior + play/pause + progress UI +
   lyrics (.lrc) loading and Spotify-like synced display.

   Behavior:
   - If an .lrc file exists next to the audio file (same base name), it is fetched and parsed.
   - Lyrics are displayed centered, current line highlighted; previous/next lines are faded.
   - Lyrics are synced to audio timeupdate; container scrolls to keep the current line centered.
   - If no .lrc found, lyrics area is hidden.
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

const lyricsWrapper = document.getElementById('lyrics-wrapper');
const lyricsContainer = document.getElementById('lyrics');

let lyricsLines = []; // {time:number, text:string}
let currentLyricIndex = -1;

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

// --- Playback UI helpers ---
function formatTime(seconds = 0) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateProgressUI() {
  const cur = audio.currentTime || 0;
  const dur = audio.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  progressEl.style.width = `${pct}%`;
  currentTimeEl.textContent = formatTime(cur);
  durationEl.textContent = dur ? formatTime(dur) : '0:00';

  // Update lyrics sync
  updateLyrics(cur);
}

function handleProgressClick(e) {
  const rect = progressContainer.getBoundingClientRect();
  const x = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  if (audio.duration) {
    audio.currentTime = pct * audio.duration;
  }
}

function togglePlay() {
  if (!audio.src) {
    console.warn('No audio source to play.');
    return;
  }
  if (audio.paused) {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        playBtn.classList.remove('fa-play');
        playBtn.classList.add('fa-pause');
      }).catch((err) => {
        console.warn('Play failed:', err);
      });
    } else {
      playBtn.classList.remove('fa-play');
      playBtn.classList.add('fa-pause');
    }
  } else {
    audio.pause();
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  }
}

function syncPlayButtonIcon() {
  if (audio.paused) {
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  } else {
    playBtn.classList.remove('fa-play');
    playBtn.classList.add('fa-pause');
  }
}

// --- Lyrics loading/parsing/rendering ---

function fetchWithTimeout(url, timeoutMs = 3500) {
  return Promise.race([
    fetch(url, {cache: "no-cache"}),
    new Promise((_, reject) => setTimeout(() => reject(new Error('fetch-timeout')), timeoutMs))
  ]);
}

function loadLrcForAudioUrl(audioUrl) {
  // only try if it's a real URL (not blob:)
  if (!audioUrl || audioUrl.startsWith('blob:')) {
    hideLyrics();
    return;
  }

  // Replace extension with .lrc
  const lrcUrl = audioUrl.replace(/\.[^/.]+$/, '.lrc');

  fetchWithTimeout(lrcUrl, 3500)
    .then(res => {
      if (!res.ok) throw new Error('no-lrc');
      return res.text();
    })
    .then(text => {
      lyricsLines = parseLRC(text);
      if (lyricsLines.length === 0) {
        hideLyrics();
      } else {
        renderLyrics(lyricsLines);
        showLyrics();
      }
    })
    .catch(err => {
      // no lrc or fetch failed -> hide lyrics
      console.warn('No .lrc found or fetch failed:', err);
      hideLyrics();
    });
}

function parseLRC(lrcText) {
  // returns array of {time:number, text:string}, sorted ascending
  const result = [];
  const lines = lrcText.split(/\r?\n/);
  for (const line of lines) {
    // find all timestamp markers in the line
    const timeMarks = [...line.matchAll(/\[(\d+):(\d+)(?:\.(\d+))?\]/g)];
    if (timeMarks.length === 0) continue;
    // strip timestamps to get text
    const text = line.replace(/\[(\d+):(\d+)(?:\.(\d+))?\]/g, '').trim();
    for (const m of timeMarks) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0; // milliseconds or centiseconds
      const time = min * 60 + sec + (frac / 1000);
      result.push({ time, text });
    }
  }
  // sort by time
  result.sort((a, b) => a.time - b.time);
  return result;
}

function renderLyrics(lines) {
  // create DOM lines
  lyricsContainer.innerHTML = ''; // clear
  for (let i = 0; i < lines.length; i++) {
    const el = document.createElement('div');
    el.className = 'lyrics-line';
    el.dataset.time = String(lines[i].time);
    el.dataset.index = String(i);
    el.textContent = lines[i].text || ' ';
    lyricsContainer.appendChild(el);
  }
  currentLyricIndex = -1;
}

function showLyrics() {
  lyricsWrapper.classList.remove('hidden');
}

function hideLyrics() {
  lyricsWrapper.classList.add('hidden');
  lyricsContainer.innerHTML = '';
  lyricsLines = [];
  currentLyricIndex = -1;
}

function updateLyrics(currentTime) {
  if (!lyricsLines || lyricsLines.length === 0) return;

  // find the last index where time <= currentTime
  let idx = -1;
  // optimize: if currentLyricIndex valid and currentTime >= its time, search forward only
  if (currentLyricIndex >= 0 && currentLyricIndex < lyricsLines.length &&
      currentTime >= lyricsLines[currentLyricIndex].time) {
    // search forward
    for (let i = currentLyricIndex; i < lyricsLines.length; i++) {
      if (i === lyricsLines.length - 1 || (lyricsLines[i+1].time > currentTime && lyricsLines[i].time <= currentTime)) {
        idx = i;
        break;
      }
    }
  } else {
    // full search (or backward)
    for (let i = 0; i < lyricsLines.length; i++) {
      if (i === lyricsLines.length - 1 || (lyricsLines[i].time <= currentTime && lyricsLines[i+1].time > currentTime)) {
        if (lyricsLines[i].time <= currentTime) idx = i;
        break;
      }
    }
  }
  if (idx === -1 && currentTime >= lyricsLines[lyricsLines.length - 1].time) {
    idx = lyricsLines.length - 1;
  }

  if (idx !== currentLyricIndex) {
    // update classes
    const prevEl = lyricsContainer.querySelector('.lyrics-line.current');
    if (prevEl) prevEl.classList.remove('current');
    if (idx >= 0) {
      const newEl = lyricsContainer.querySelector(`.lyrics-line[data-index="${idx}"]`);
      if (newEl) {
        newEl.classList.add('current');
        // scroll so the current line is centered in the lyrics container
        // use smooth scrolling for nicer effect, but don't call too frequently
        newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    currentLyricIndex = idx;
  }
}

// --- Initialization & event wiring ---
async function init() {
  // Put UI into loading state and hide text + art until we finish
  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';
  titleEl.textContent = '';
  artistEl.textContent = '';
  coverImg.style.visibility = 'hidden';
  hideLyrics();

  // Attach event listeners for playback/progress
  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    togglePlay();
  });
  if (prevBtn) prevBtn.addEventListener('click', () => { audio.currentTime = 0; });
  if (nextBtn) nextBtn.addEventListener('click', () => { audio.currentTime = 0; });

  audio.addEventListener('timeupdate', updateProgressUI);
  audio.addEventListener('loadedmetadata', updateProgressUI);
  audio.addEventListener('play', syncPlayButtonIcon);
  audio.addEventListener('pause', syncPlayButtonIcon);
  audio.addEventListener('ended', () => {
    playBtn.classList.remove('fa-pause');
    playBtn.classList.add('fa-play');
  });

  if (progressContainer) {
    progressContainer.addEventListener('click', handleProgressClick);
    progressContainer.addEventListener('touchstart', (e) => {
      handleProgressClick(e);
      e.preventDefault();
    }, { passive: false });
  }

  // If audio has a src attribute, attempt to read tags via URL Reader and try to load .lrc
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
      titleEl.textContent = getFilenameFromSrc(absoluteUrl) || '';
      artistEl.textContent = '';
      console.warn('Could not read tags from URL (CORS, timeout or not accessible). Fallback to filename.', err);
    } finally {
      revealUI();
      syncPlayButtonIcon();
      // attempt to load .lrc (fire-and-forget)
      loadLrcForAudioUrl(absoluteUrl);
    }
  } else {
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
  hideLyrics();

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
    // For user-picked local file, .lrc next to the audio file won't be reachable.
    // You could allow uploading a .lrc file in the UI — we did not add upload here.
  }
});

// Kick off initial load
init();

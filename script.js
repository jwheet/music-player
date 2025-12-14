/* script.js
   Adds:
   - lyrics fullscreen toggle (uses Fullscreen API with CSS fallback)
   - background gradient generated from cover image colors (Color Thief)
   - kept previous functionality: metadata (jsmediatags), play/pause, progress, LRC lyrics sync

   Notes:
   - Color extraction requires access to the image pixels. It works reliably when the cover is a data: URL
     (embedded from tags) or when the image is same-origin / CORS-enabled. If blocked, a default gradient is used.
   - Fullscreen API is used where available; fallback toggles a CSS "fullscreen-fallback" class.
*/

const audio = document.getElementById('audio');
const fileInput = document.getElementById('file-input');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const coverImg = document.getElementById('cover-img');
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
const lyricsFullscreenBtn = document.getElementById('lyrics-fullscreen-btn');
const lyricsFullscreenIcon = document.getElementById('lyrics-fullscreen-icon');

let lyricsLines = []; // {time:number, text:string}
let currentLyricIndex = -1;

// ColorThief instance (uses UMD build loaded in HTML)
const colorThief = window.ColorThief ? new window.ColorThief() : null;

// -------------------- Helpers --------------------
function clamp(v, a = 0, b = 255) { return Math.max(a, Math.min(b, v)); }
function rgbToCss(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Smoothly apply gradient to the body background
function setBackgroundGradientFromColors(colors = []) {
  if (!colors || colors.length === 0) {
    // fallback subtle gradient
    document.body.style.background = 'linear-gradient(135deg, #0f172a 0%, #0b1220 100%)';
    return;
  }
  // pick up to first 4 colors
  const picks = colors.slice(0, 4);
  const stops = picks.map((c, i) => {
    const pct = Math.round((i / Math.max(1, picks.length - 1)) * 100);
    return `${rgbToCss(c)} ${pct}%`;
  }).join(', ');
  const gradient = `linear-gradient(135deg, ${stops})`;
  document.body.style.transition = 'background 600ms ease';
  document.body.style.background = gradient;
}

// Attempt to build a nice gradient using ColorThief palette
function applyGradientFromImage(imgEl) {
  if (!imgEl || !colorThief) {
    setBackgroundGradientFromColors();
    return;
  }

  // Ensure image is loaded
  if (!imgEl.complete) {
    // wait for load once
    imgEl.addEventListener('load', function onLoad() {
      imgEl.removeEventListener('load', onLoad);
      _extractAndApply(imgEl);
    });
  } else {
    _extractAndApply(imgEl);
  }

  function _extractAndApply(img) {
    try {
      // ColorThief may throw if canvas is tainted (CORS). Catch and fallback.
      // Use palette of 5 colors for variety
      const palette = colorThief.getPalette(img, 5);
      if (!palette || palette.length === 0) {
        setBackgroundGradientFromColors();
        return;
      }
      // Optionally sort by perceived brightness to make gradient pleasant
      const withLum = palette.map(c => {
        const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        return { c, lum };
      }).sort((a, b) => a.lum - b.lum);

      // pick darkest -> mid -> lightest for gradient
      const colorsForGradient = [
        withLum[0].c,
        withLum[Math.floor(withLum.length / 2)].c,
        withLum[withLum.length - 1].c
      ].filter(Boolean);

      setBackgroundGradientFromColors(colorsForGradient);
    } catch (err) {
      // likely CORS/tainted canvas; fallback to default gradient
      console.warn('Could not extract palette from cover image (CORS?):', err);
      setBackgroundGradientFromColors();
    }
  }
}

// Converts jsmediatags picture -> data URL
function pictureToDataURL(picture) {
  if (!picture || !picture.data) return null;
  const byteArray = picture.data;
  let binary = '';
  // build binary string (works for typical cover sizes)
  for (let i = 0; i < byteArray.length; i++) {
    binary += String.fromCharCode(byteArray[i]);
  }
  const base64 = btoa(binary);
  return `data:${picture.format};base64,${base64}`;
}

// -------------------- Metadata / cover / gradient wiring --------------------
function setMetadataAndCover({ title, artist, picture } = {}) {
  titleEl.textContent = title || titleEl.textContent || '';
  artistEl.textContent = artist || artistEl.textContent || '';

  // If tags include picture, use it (data URL) — this is best for ColorThief
  if (picture && picture.data) {
    const dataUrl = pictureToDataURL(picture);
    if (dataUrl) {
      coverImg.src = dataUrl;
      coverImg.style.visibility = 'visible';
      // after setting cover to data url, ColorThief can access it
      applyGradientFromImage(coverImg);
      return;
    }
  }

  // Otherwise try to use current coverImg src (may be same-origin or CORS-enabled)
  if (coverImg.src) {
    applyGradientFromImage(coverImg);
  } else {
    setBackgroundGradientFromColors();
  }
}

// -------------------- Playback UI helpers --------------------
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

// -------------------- LRC lyrics --------------------
function fetchWithTimeout(url, timeoutMs = 3500) {
  return Promise.race([
    fetch(url, {cache: "no-cache"}),
    new Promise((_, reject) => setTimeout(() => reject(new Error('fetch-timeout')), timeoutMs))
  ]);
}

function loadLrcForAudioUrl(audioUrl) {
  if (!audioUrl || audioUrl.startsWith('blob:')) {
    hideLyrics();
    return;
  }
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
      console.warn('No .lrc found or fetch failed:', err);
      hideLyrics();
    });
}

function parseLRC(lrcText) {
  const result = [];
  const lines = lrcText.split(/\r?\n/);
  for (const line of lines) {
    const timeMarks = [...line.matchAll(/\[(\d+):(\d+)(?:\.(\d+))?\]/g)];
    if (timeMarks.length === 0) continue;
    const text = line.replace(/\[(\d+):(\d+)(?:\.(\d+))?\]/g, '').trim();
    for (const m of timeMarks) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      const time = min * 60 + sec + (frac / 1000);
      result.push({ time, text });
    }
  }
  result.sort((a, b) => a.time - b.time);
  return result;
}

function renderLyrics(lines) {
  lyricsContainer.innerHTML = '';
  for (let i = 0; i < lines.length; i++) {
    const el = document.createElement('div');
    el.className = 'lyrics-line';
    el.dataset.time = String(lines[i].time);
    el.dataset.index = String(i);
    el.textContent = lines[i].text || ' ';

    // Add click-to-seek functionality
    el.addEventListener('click', function() {
      const seekTime = parseFloat(this.dataset.time);
      if (!isNaN(seekTime) && audio.duration) {
        audio.currentTime = seekTime;
        // Auto-play if paused
        if (audio.paused) {
          togglePlay();
        }
      }
    });

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
  let idx = -1;
  if (currentLyricIndex >= 0 && currentLyricIndex < lyricsLines.length &&
      currentTime >= lyricsLines[currentLyricIndex].time) {
    for (let i = currentLyricIndex; i < lyricsLines.length; i++) {
      if (i === lyricsLines.length - 1 || (lyricsLines[i+1].time > currentTime && lyricsLines[i].time <= currentTime)) {
        idx = i;
        break;
      }
    }
  } else {
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
    const prevEl = lyricsContainer.querySelector('.lyrics-line.current');
    if (prevEl) prevEl.classList.remove('current');
    if (idx >= 0) {
      const newEl = lyricsContainer.querySelector(`.lyrics-line[data-index="${idx}"]`);
      if (newEl) {
        newEl.classList.add('current');
        newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    currentLyricIndex = idx;
  }
}

// -------------------- Fullscreen lyrics handling --------------------
function isFullscreenSupported() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || document.mozFullScreenEnabled || document.msFullscreenEnabled);
}

function enterFullscreenForElement(el) {
  if (!el) return;
  // Prefer Fullscreen API
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  // Fallback: add class to style as fullscreen overlay
  el.classList.add('fullscreen-fallback');
  document.documentElement.style.overflow = 'hidden';
  lyricsFullscreenBtn.setAttribute('aria-pressed', 'true');
  lyricsFullscreenIcon.classList.remove('fa-expand');
  lyricsFullscreenIcon.classList.add('fa-compress');
}

function exitFullscreenFallback(el) {
  el.classList.remove('fullscreen-fallback');
  document.documentElement.style.overflow = '';
  lyricsFullscreenBtn.setAttribute('aria-pressed', 'false');
  lyricsFullscreenIcon.classList.remove('fa-compress');
  lyricsFullscreenIcon.classList.add('fa-expand');
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
  // fallback
  exitFullscreenFallback(lyricsWrapper);
}

function toggleLyricsFullscreen() {
  const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  if (!inFs) {
    if (isFullscreenSupported()) {
      enterFullscreenForElement(lyricsWrapper).catch(() => {
        // if requestFullscreen fails, fallback to class
        lyricsWrapper.classList.add('fullscreen-fallback');
        lyricsFullscreenBtn.setAttribute('aria-pressed', 'true');
        lyricsFullscreenIcon.classList.remove('fa-expand');
        lyricsFullscreenIcon.classList.add('fa-compress');
      });
    } else {
      // fallback
      lyricsWrapper.classList.add('fullscreen-fallback');
      lyricsFullscreenBtn.setAttribute('aria-pressed', 'true');
      lyricsFullscreenIcon.classList.remove('fa-expand');
      lyricsFullscreenIcon.classList.add('fa-compress');
    }
  } else {
    exitFullscreen();
  }
}

// Update fullscreen icon on fullscreenchange events (keeps UI in sync)
function onFullscreenChange() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (fsEl === lyricsWrapper) {
    lyricsFullscreenBtn.setAttribute('aria-pressed', 'true');
    lyricsFullscreenIcon.classList.remove('fa-expand');
    lyricsFullscreenIcon.classList.add('fa-compress');
  } else {
    // If we previously used fallback class, remove it
    if (lyricsWrapper.classList.contains('fullscreen-fallback')) {
      exitFullscreenFallback(lyricsWrapper);
    }
    lyricsFullscreenBtn.setAttribute('aria-pressed', 'false');
    lyricsFullscreenIcon.classList.remove('fa-compress');
    lyricsFullscreenIcon.classList.add('fa-expand');
  }
}

// Ensure we listen for fullscreen change to update icon
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
  document.addEventListener(evt, onFullscreenChange);
});

// -------------------- Initialization & wiring --------------------
function readTagsFromUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      new jsmediatags.Reader(url)
        .setTagsToRead(['title', 'artist', 'picture'])
        .read({
          onSuccess: function(tag) { resolve(tag.tags); },
          onError: function(err) { reject(err); }
        });
    } catch (err) {
      reject(err);
    }
  });
}
function readTagsFromFile(file) {
  return new Promise((resolve, reject) => {
    try {
      jsmediatags.read(file, {
        onSuccess: function(tag) { resolve(tag.tags); },
        onError: function(err) { reject(err); }
      });
    } catch (err) { reject(err); }
  });
}
function readTagsFromUrlWithTimeout(url, timeoutMs = 3500) {
  return Promise.race([
    readTagsFromUrl(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('tag-read-timeout')), timeoutMs))
  ]);
}

async function init() {
  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';
  titleEl.textContent = '';
  artistEl.textContent = '';
  coverImg.style.visibility = 'hidden';
  hideLyrics();

  // play/progress listeners
  playBtn.addEventListener('click', (e) => { e.preventDefault(); togglePlay(); });
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
    progressContainer.addEventListener('touchstart', (e) => { handleProgressClick(e); e.preventDefault(); }, { passive: false });
  }

  // fullscreen button wiring
  if (lyricsFullscreenBtn) {
    lyricsFullscreenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleLyricsFullscreen();
    });
  }

  // If audio has a src attribute, attempt to read tags and load .lrc
  const urlAttr = audio.getAttribute('src');
  const url = urlAttr || audio.src;
  if (url) {
    const absoluteUrl = new URL(url, location.href).href;
    try {
      const tags = await readTagsFromUrlWithTimeout(absoluteUrl, 3500);
      setMetadataAndCover(tags);
      if (!tags.title) titleEl.textContent = getFilenameFromSrc(absoluteUrl);
      if (!tags.picture) coverImg.style.visibility = 'visible'; // cover might be file in repo
    } catch (err) {
      // fallback to filename and try to use existing cover img
      titleEl.textContent = getFilenameFromSrc(absoluteUrl) || '';
      artistEl.textContent = '';
      console.warn('Could not read tags from URL (CORS/timeout).', err);
      // still try to apply gradient from coverImg if possible
      applyGradientFromImage(coverImg);
    } finally {
      revealUI();
      syncPlayButtonIcon();
      // fire-and-forget LRC load
      loadLrcForAudioUrl(absoluteUrl);
    }
  } else {
    revealUI();
    syncPlayButtonIcon();
  }
}

fileInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const file = files[0];

  container.classList.add('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = '';
  titleEl.textContent = '';
  artistEl.textContent = '';
  coverImg.style.visibility = 'hidden';
  hideLyrics();

  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.load();

  try {
    const tags = await readTagsFromFile(file);
    setMetadataAndCover(tags);
    if (!tags.title) titleEl.textContent = file.name;
    if (!tags.artist) artistEl.textContent = '';
  } catch (err) {
    titleEl.textContent = file.name;
    artistEl.textContent = '';
    coverImg.style.visibility = 'visible';
    applyGradientFromImage(coverImg);
    console.warn('Could not read tags from selected file.', err);
  } finally {
    revealUI();
    syncPlayButtonIcon();
    // NOTE: local .lrc next to local file isn't accessible; you could add an upload option.
  }
});

// reveal UI helper
function revealUI() {
  container.classList.remove('loading');
  if (spinnerWrapper) spinnerWrapper.style.display = 'none';
}

// filename fallback
function getFilenameFromSrc(src) {
  if (!src) return '';
  try {
    const url = new URL(src, location.href);
    return decodeURIComponent(url.pathname.split('/').pop());
  } catch (e) {
    return src.split('/').pop();
  }
}

// Kick off
init();

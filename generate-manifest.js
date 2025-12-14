#!/usr/bin/env node

/**
 * generate-manifest.js
 *
 * Automatically generates songs.json from the music/ folder.
 * Extracts track numbers, titles, and artists from filenames.
 *
 * Usage: node generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

const MUSIC_DIR = path.join(__dirname, 'music');
const OUTPUT_FILE = path.join(__dirname, 'songs.json');

/**
 * Parses filename to extract metadata
 * Format: "[NUMBER].[TITLE] - [ARTIST].flac"
 * Example: "1.Abigail - Frankie Cosmos.flac"
 */
function parseFilename(filename) {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Extract track number (everything before first period)
  const firstDotIndex = nameWithoutExt.indexOf('.');
  if (firstDotIndex === -1) return null;

  const trackNumberStr = nameWithoutExt.substring(0, firstDotIndex);
  const trackNumber = parseInt(trackNumberStr, 10);
  if (isNaN(trackNumber)) return null;

  // Extract title and artist (format: "TITLE - ARTIST")
  const remainder = nameWithoutExt.substring(firstDotIndex + 1);
  const dashIndex = remainder.lastIndexOf(' - ');

  let title = remainder;
  let artist = '';

  if (dashIndex !== -1) {
    title = remainder.substring(0, dashIndex).trim();
    artist = remainder.substring(dashIndex + 3).trim();
  }

  return {
    trackNumber,
    title,
    artist
  };
}

function generateManifest() {
  console.log('Scanning music directory:', MUSIC_DIR);

  // Read all files in music directory
  const files = fs.readdirSync(MUSIC_DIR);

  // Filter for FLAC files and parse metadata
  const songs = [];

  for (const file of files) {
    if (!file.endsWith('.flac')) continue;

    const metadata = parseFilename(file);
    if (!metadata) {
      console.warn(`Warning: Could not parse filename: ${file}`);
      continue;
    }

    songs.push({
      path: `music/${file}`,
      trackNumber: metadata.trackNumber,
      title: metadata.title,
      artist: metadata.artist
    });
  }

  // Sort by track number
  songs.sort((a, b) => a.trackNumber - b.trackNumber);

  console.log(`Found ${songs.length} songs`);

  // Validate sequential track numbers
  for (let i = 0; i < songs.length; i++) {
    if (songs[i].trackNumber !== i + 1) {
      console.warn(`Warning: Track number gap detected at position ${i + 1}`);
    }
  }

  // Create manifest object
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalSongs: songs.length,
    songs: songs
  };

  // Write to file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`✓ Manifest written to ${OUTPUT_FILE}`);
  console.log('\nFirst 3 songs:');
  songs.slice(0, 3).forEach(song => {
    console.log(`  ${song.trackNumber}. ${song.title} - ${song.artist}`);
  });
}

// Run
try {
  generateManifest();
} catch (err) {
  console.error('Error generating manifest:', err);
  process.exit(1);
}

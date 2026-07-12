/**
 * @file lastfm.js — Last.fm API helper for scrobbling and Now Playing updates.
 *
 * Handles API signature generation (MD5), authenticated POST calls to the
 * Last.fm Web Services API, and enforces the official scrobbling thresholds
 * (≥30 seconds played AND ≥50% of track duration).
 *
 * @license AGPL-3.0-or-later
 * @copyright 2026 Shane W Watson
 */

const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { version: APP_VERSION } = require('./package.json');

const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

/* global fetch */

/**
 * Generates a Last.fm API signature by sorting params alphabetically,
 * concatenating key+value pairs, appending the shared secret, and MD5-hashing.
 * @param {object} params - Request parameters (excluding api_sig and format).
 * @param {string} secret - Last.fm shared secret.
 * @returns {string} Lowercase hex MD5 hash.
 */
function sign(params, secret) {
  const sorted = Object.keys(params)
    .filter(k => k !== 'api_sig' && k !== 'format')
    .sort();
  const str = sorted.map(k => `${k}${params[k]}`).join('') + secret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

/**
 * Performs an authenticated POST call to the Last.fm API.
 * @param {object} params - All request parameters (api_key, method, etc.)
 * @param {string} secret - Shared secret (used to compute api_sig).
 * @returns {Promise<object>} Parsed JSON response.
 */
async function apiCall(params, secret) {
  const signed = { ...params, api_sig: sign(params, secret), format: 'json' };
  const body = new URLSearchParams(signed).toString();

  const response = await fetch(LASTFM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `YourOwnPersonalDJ/${APP_VERSION}`
    },
    body
  });

  const json = await response.json();

  if (json.error) {
    throw new Error(`Last.fm API error ${json.error}: ${json.message}`);
  }

  return json;
}

/**
 * Sends a "Now Playing" notification to Last.fm.
 * @param {object} track - Track object with title, artist, album, duration.
 * @param {object} config - Last.fm config with apiKey, apiSecret, sessionKey.
 */
async function updateNowPlaying(track, config) {
  const params = {
    method: 'track.updateNowPlaying',
    api_key: config.apiKey,
    sk: config.sessionKey,
    artist: track.artist || 'Unknown Artist',
    track: track.title || 'Unknown Track'
  };

  if (track.album) params.album = track.album;
  if (track.duration) params.duration = Math.floor(track.duration);

  return apiCall(params, config.apiSecret);
}

/**
 * Scrobbles a track to Last.fm if it meets the threshold requirements.
 *
 * Rules (per Last.fm's official spec):
 *   - The track must be ≥ 30 seconds long.
 *   - The user must have listened for ≥ 30 seconds OR ≥ 50% of the track
 *     duration, whichever comes first. (Common desktop client interpretation:
 *     both 30s and 50% must be satisfied unless the track is < 60s.)
 *
 * @param {object} track - Track object.
 * @param {number} startTimeSec - UNIX timestamp (seconds) when the track started.
 * @param {number} playedSec - Total seconds actually played (accounts for pauses).
 * @param {object} config - Last.fm config.
 * @returns {Promise<{scrobbled: boolean, reason: string}>}
 */
async function scrobble(track, startTimeSec, playedSec, config) {
  const durationSec = track.duration || 0;

  // Minimum track length: 30 seconds
  if (durationSec > 0 && durationSec < 30) {
    return { scrobbled: false, reason: 'Track too short (< 30s)' };
  }

  const halfDuration = durationSec > 0 ? durationSec / 2 : Infinity;
  const threshold = Math.min(240, halfDuration); // cap at 4 minutes per spec

  if (playedSec < 30 || playedSec < threshold) {
    return { scrobbled: false, reason: `Threshold not met (played ${Math.round(playedSec)}s of ${Math.round(threshold)}s required)` };
  }

  const params = {
    method: 'track.scrobble',
    api_key: config.apiKey,
    sk: config.sessionKey,
    'artist[0]': track.artist || 'Unknown Artist',
    'track[0]': track.title || 'Unknown Track',
    'timestamp[0]': String(Math.floor(startTimeSec))
  };

  if (track.album) params['album[0]'] = track.album;

  await apiCall(params, config.apiSecret);
  return { scrobbled: true, reason: 'OK' };
}

module.exports = { sign, apiCall, updateNowPlaying, scrobble };

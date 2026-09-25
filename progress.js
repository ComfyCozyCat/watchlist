import {seal, openSealed} from './crypto.js?v=20260925-edit-1';

const API = 'https://api.github.com/repos/ComfyCozyCat/watchlist/contents/';
const FILE = 'watchlist-progress.json';
const AAD = 'watchlist-progress-v1';
const MAX_SECONDS = 359999999; // 99,999 hours; also bounds malformed unknown-duration input.
export function clampTime(hours, minutes, seconds, duration) {
  const integer = value => Math.max(0, Math.floor(Number(value) || 0));
  const total = Math.min(99999, integer(hours)) * 3600 + Math.min(59, integer(minutes)) * 60 + Math.min(59, integer(seconds));
  return Math.min(total, Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : MAX_SECONDS);
}
export function episodeKey(show, season, episode) {
  // Numbered identities survive title/disc edits. Unnumbered titles must be unique;
  // renamed/ambiguous entries are deliberately not guessed by list position.
  return JSON.stringify([show.name, String(season.number), Number.isInteger(episode.number) ? ['number', episode.number] : ['title', episode.title || '']]);
}
export function catalog(snapshot) {
  const rows = [];
  for (const show of snapshot.shows) for (const season of show.seasons || []) for (const episode of season.episodes || []) {
    rows.push({show, season, episode, key:episodeKey(show, season, episode)});
  }
  return rows;
}
export function episodeIndex(snapshot) {
  const index = new Map();
  for (const row of catalog(snapshot)) index.set(row.key, index.has(row.key) ? null : row);
  return index;
}
export function uniqueEpisode(snapshot, key) { return episodeIndex(snapshot).get(key) || null; }
export function emptyProgress() { return {version:1, kind:'website-progress', edits:[]}; }
export function validateProgress(value) {
  if (value?.version !== 1 || value.kind !== 'website-progress' || !Array.isArray(value.edits) || value.edits.length > 10000) throw new Error('The online progress file could not be read. Nothing was overwritten.');
  const keys = new Set();
  for (const edit of value.edits) {
    if (typeof edit.key !== 'string' || edit.key.length > 10000 || keys.has(edit.key) || typeof edit.watched !== 'boolean' || !Number.isInteger(edit.position_seconds) || edit.position_seconds < 0 || edit.position_seconds > MAX_SECONDS || typeof edit.revision !== 'string' || !Number.isFinite(Date.parse(edit.updated_at))) throw new Error('The online progress file could not be read. Nothing was overwritten.');
    keys.add(edit.key);
  }
  return value;
}
export function applyProgress(base, progress) {
  const result = structuredClone(base);
  const touched = new Map();
  const index = episodeIndex(result);
  for (const edit of progress.edits) {
    const match = index.get(edit.key);
    if (!match) continue;
    const {show, episode} = match;
    episode.watched = edit.watched;
    episode.position_seconds = edit.watched ? null : Math.min(edit.position_seconds, Number.isFinite(episode.duration_seconds) && episode.duration_seconds > 0 ? Math.floor(episode.duration_seconds) : MAX_SECONDS);
    const previous = touched.get(show);
    if (!previous || edit.updated_at > previous.edit.updated_at) touched.set(show, {edit, match});
  }
  for (const [show, {edit, match}] of touched) {
    const rows = catalog({shows:[show]});
    let target = match;
    if (edit.watched) {
      const index = rows.findIndex(row => row.key === edit.key);
      target = [...rows.slice(index + 1), ...rows.slice(0, index)].find(row => !row.episode.watched) || match;
    }
    for (const row of rows) row.episode.current = row.key === target.key;
    const ep = target.episode;
    show.season = String(target.season.number);
    show.episode = Number.isInteger(ep.number) ? `Episode ${String(ep.number).padStart(2, '0')}` : ep.title || 'Untitled episode';
    show.status = ep.watched ? 'caught_up' : ep.position_seconds > 0 ? 'resume' : 'next';
    delete show.position_seconds; delete show.disc; delete show.disc_position;
    if (show.status === 'resume') show.position_seconds = ep.position_seconds;
    if (ep.disc) { show.disc = ep.disc; show.disc_position = ep.disc_position; }
  }
  return result;
}

export class ProgressStore {
  constructor() { this.token = ''; this.controller = new AbortController(); }
  reset() { this.controller.abort(); this.controller = new AbortController(); this.token = ''; }
  async request(file, options = {}) {
    const headers = {'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', ...options.headers};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 20000);
    try {
      const response = await fetch(API + file + (options.method === 'PUT' ? '' : '?ref=main'), {
        ...options, headers, credentials:'omit', redirect:'error', cache:'no-store',
        signal:AbortSignal.any([this.controller.signal, timeout.signal]),
      });
      return response;
    } catch { throw new Error('Couldn’t reach GitHub. Your input is still here; reconnect and try Save again.'); }
    finally { clearTimeout(timer); }
  }
  async read(file, missingOK = false) {
    const response = await this.request(file);
    if (response.status === 404 && missingOK) return {sha:null, envelope:null};
    if (!response.ok) throw new Error(this.error(response.status));
    const record = await response.json();
    if (record.type !== 'file' || record.encoding !== 'base64' || typeof record.sha !== 'string' || record.size > 2000000 || typeof record.content !== 'string' || record.content.length > 3000000) throw new Error('The online file is unsupported. Nothing was overwritten.');
    try { return {sha:record.sha, envelope:JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(atob(record.content.replace(/\s/g,'')), c => c.charCodeAt(0))))}; }
    catch { throw new Error('The online file could not be read. Nothing was overwritten.'); }
  }
  error(status) {
    if (status === 401) return 'Editing access expired or is invalid. Open Editing setup and replace the token.';
    if (status === 403 || status === 429) return 'GitHub refused this request. Check token Contents read/write access, or try again after its request limit resets.';
    if (status === 404) return 'GitHub could not find the Watchlist file. Check that the token has access to the watchlist repository.';
    return 'GitHub could not save or load this update. Your input is still here; try again.';
  }
  async readProgress(key, salt) {
    const record = await this.read(FILE, true);
    if (!record.envelope) return {...record, value:emptyProgress()};
    if (record.envelope.salt !== salt) throw new Error('Online edits use a different watchlist password. Nothing was overwritten; restore the previous password or migrate those edits first.');
    try { return {...record, value:validateProgress(await openSealed(record.envelope, key, AAD))}; }
    catch { throw new Error('Couldn’t unlock online edits. Nothing was overwritten.'); }
  }
  async save(key, salt, edit, expectedRevision, baseSnapshot) {
    if (!this.token) throw new Error('Open Editing setup and connect your token first.');
    const signal = this.controller.signal;
    const stillActive = () => { if (signal.aborted) throw new Error('Editing session ended. Unlock and try again.'); };
    // Never encrypt against a stale password while the desktop is changing it.
    const desktop = await this.read('watchlist-data.json');
    if (desktop.envelope.salt !== salt) throw new Error('The watchlist password changed. Lock and unlock with the new password before saving.');
    stillActive();
    const source = await openSealed(desktop.envelope, key, 'watchlist-v1');
    const match = uniqueEpisode(source, edit.key);
    if (!match) throw new Error('This episode changed or is ambiguous in the latest desktop list. Cancel, refresh, and select it again.');
    for (let attempt = 0; attempt < 3; attempt++) {
      stillActive();
      const remote = await this.readProgress(key, salt);
      const current = remote.value.edits.find(item => item.key === edit.key);
      if ((current?.revision || null) !== expectedRevision) throw new Error('This episode was edited in another tab or browser. Cancel and Refresh to review its latest progress before editing again.');
      // Explicit allowlist: browser credentials can never enter the progress payload.
      const update = {key:edit.key, watched:edit.watched === true,
        position_seconds:edit.watched ? 0 : Math.min(edit.position_seconds, Number.isFinite(match.episode.duration_seconds) && match.episode.duration_seconds > 0 ? Math.floor(match.episode.duration_seconds) : MAX_SECONDS),
        updated_at:new Date().toISOString(), revision:crypto.randomUUID(),
        source:{snapshot_updated_at:source.updated_at || baseSnapshot.updated_at || null,
          show:match.show.name, season:String(match.season.number), episode_number:match.episode.number ?? null,
          episode_title:match.episode.title || '', duration_seconds:match.episode.duration_seconds ?? null,
          watched:match.episode.watched === true, position_seconds:match.episode.position_seconds ?? null}};
      const value = validateProgress({version:1, kind:'website-progress', updated_at:update.updated_at,
        edits:[...remote.value.edits.filter(item => item.key !== edit.key), update]});
      const encrypted = await seal(value, key, salt, AAD);
      const json = JSON.stringify(encrypted, null, 2) + '\n';
      const bytes = new TextEncoder().encode(json);
      if (bytes.length > 1900000) throw new Error('The progress file is full. Nothing was overwritten.');
      let encoded = ''; for (const byte of bytes) encoded += String.fromCharCode(byte);
      stillActive();
      const response = await this.request(FILE, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:'Update encrypted website progress', content:btoa(encoded), branch:'main', ...(remote.sha ? {sha:remote.sha} : {})})});
      if (response.ok) return value;
      if (response.status === 409 || response.status === 422) continue;
      throw new Error(this.error(response.status));
    }
    throw new Error('The online file changed while saving. Your input is still here; try Save again.');
  }
}

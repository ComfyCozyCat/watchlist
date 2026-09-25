import {seal, openSealed} from './crypto.js?v=20260925-edit-1';
import {clampTime, episodeKey, uniqueEpisode} from './progress.js?v=20260925-edit-1';
const $ = id => document.getElementById(id);
const tokenKey = `watchlist:${location.pathname}:editing`;
const TOKEN_AAD = 'watchlist-local-editing-token-v1';

export class Editor {
  constructor(store, context, changed) {
    this.store = store; this.context = context; this.changed = changed;
    this.busy = false; this.entry = null; this.serial = 0;
    $('editing-setup').onclick = () => { $('setup-message').textContent = ''; $('token').value = ''; $('setup-dialog').showModal(); };
    $('setup-close').onclick = () => $('setup-dialog').close();
    $('forget-editing').onclick = () => {
      this.serial++; this.store.reset(); this.busy = false;
      try { localStorage.removeItem(tokenKey); } catch {}
      $('token').value = ''; this.status(); $('setup-message').textContent = 'Editing access forgotten on this device.';
    };
    $('setup-form').onsubmit = event => { event.preventDefault(); this.connect(); };
    $('editor-cancel').onclick = () => $('editor-dialog').close();
    $('editor-dialog').addEventListener('close', () => { this.entry = null; });
    $('editor-dialog').addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('setup-dialog').addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('editor-form').onsubmit = event => { event.preventDefault(); this.save(); };
    for (const id of ['hours','minutes','seconds']) {
      $(id).addEventListener('focus', () => $(id).select());
      $(id).addEventListener('input', () => {
        $(id).value = $(id).value.replace(/\D/g, '').slice(0, $(id).maxLength);
        $('episode-state').value = 'progress';
      });
      $(id).addEventListener('blur', () => this.normalize());
    }
    $('episode-state').onchange = () => {
      if ($('episode-state').value === 'unwatched') this.setTime(0);
      this.timeState();
    };
    window.addEventListener('storage', event => {
      if (event.key === tokenKey || event.key === null) {
        this.serial++; this.store.reset(); this.busy = false;
        $('token').value = ''; this.close(); this.buttons(false); this.status();
        if (event.newValue && this.context().key) this.restore();
      }
    });
    this.status();
  }
  isOpen() { return $('editor-dialog').open || $('setup-dialog').open; }
  status() {
    $('editing-state').textContent = this.store.token ? 'Editing connected' : 'Connect editing to save progress';
    $('forget-editing').hidden = !this.store.token && !this.hasStoredToken();
  }
  hasStoredToken() { try { return Boolean(localStorage.getItem(tokenKey)); } catch { return false; } }
  close() {
    $('editor-dialog').close(); $('setup-dialog').close(); this.entry = null;
    $('token').value = ''; $('editor-message').textContent = ''; $('setup-message').textContent = '';
    $('hours').value = ''; $('minutes').value = ''; $('seconds').value = '';
    $('editor-title').textContent = ''; $('editor-context').textContent = ''; $('duration-hint').textContent = '';
  }
  lock() { this.serial++; this.store.reset(); this.busy = false; this.close(); this.buttons(false); this.status(); }
  buttons(busy) {
    this.busy = busy;
    for (const id of ['editor-save','editor-cancel','setup-save','setup-close','forget-editing','episode-state','hours','minutes','seconds','token','remember-editing']) $(id).disabled = busy;
    $('editor-save').textContent = busy ? 'Saving…' : 'Save';
    $('setup-save').textContent = busy ? 'Connecting…' : 'Connect editing';
    if (!busy && this.entry) this.timeState();
  }
  async restore() {
    const {key, salt, generation} = this.context();
    const serial = this.serial;
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(tokenKey));
      if (!saved) { this.status(); return; }
      if (saved.salt !== salt) { this.status(); return; }
      const value = await openSealed(saved, key, TOKEN_AAD);
      if (this.context().generation !== generation || this.serial !== serial) return;
      if (typeof value.token === 'string') this.store.token = value.token;
    } catch { /* Keep viewing available even if browser storage was cleared. */ }
    if (this.context().generation === generation && this.serial === serial) this.status();
  }
  async connect() {
    const {key, salt, generation} = this.context();
    const serial = this.serial;
    const token = $('token').value.trim();
    if (!token || !key || this.busy) return;
    if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) { $('setup-message').textContent = 'Paste your fine-grained GitHub token (it starts with github_pat_).'; return; }
    const remember = $('remember-editing').checked;
    const previous = this.store.token;
    this.buttons(true); this.store.token = token;
    $('setup-message').textContent = 'Checking access to your Watchlist…';
    try {
      await this.store.read('watchlist-data.json');
      const encrypted = remember ? await seal({token}, key, salt, TOKEN_AAD) : null;
      if (this.context().generation !== generation || this.serial !== serial) return;
      let remembered = false;
      try {
        if (encrypted) { localStorage.setItem(tokenKey, JSON.stringify(encrypted)); remembered = true; }
        else localStorage.removeItem(tokenKey);
      } catch {}
      $('token').value = ''; this.status();
      $('setup-message').textContent = remember && !remembered ? 'Connected for this session, but this browser could not remember access.' : remembered ? 'Connected and remembered on this device. You can close this window and edit an episode.' : 'Connected for this session. You can close this window and edit an episode.';
    } catch (error) {
      if (this.context().generation !== generation || this.serial !== serial) return;
      this.store.token = previous; this.status(); $('setup-message').textContent = error.message;
    } finally { if (this.context().generation === generation && this.serial === serial) this.buttons(false); }
  }
  open(show, season, episode, label) {
    const ctx = this.context();
    const key = episodeKey(show, season, episode);
    if (!uniqueEpisode(ctx.base, key)) return;
    if (!this.store.token) { $('setup-message').textContent = 'Connect editing once, then select Edit again.'; $('setup-dialog').showModal(); return; }
    this.entry = {key, duration:episode.duration_seconds, expectedRevision:ctx.progress.edits.find(item => item.key === key)?.revision || null};
    $('editor-title').textContent = label;
    $('editor-context').textContent = `${show.name} · Season ${season.number}${episode.disc ? ` · Disc ${String(episode.disc).padStart(2,'0')}` : ''}`;
    $('hours').maxLength = Number.isFinite(episode.duration_seconds) && episode.duration_seconds > 0 ? Math.max(2, String(Math.floor(episode.duration_seconds / 3600)).length) : 5;
    $('episode-state').value = episode.watched ? 'watched' : episode.position_seconds > 0 ? 'progress' : 'unwatched';
    this.setTime(episode.position_seconds || 0); this.timeState();
    $('duration-hint').textContent = episode.duration_seconds > 0 ? `Length: ${format(episode.duration_seconds)}. Times beyond the end adjust to this length.` : 'Length unknown. Enter where you stopped.';
    $('editor-message').textContent = ''; this.buttons(false);
    $('editor-dialog').showModal();
    // Avoid opening the phone keyboard until the user taps a time field.
    $('episode-state').focus();
  }
  setTime(value) {
    $('hours').value = String(Math.floor(value / 3600)).padStart(2,'0');
    $('minutes').value = String(Math.floor(value / 60) % 60).padStart(2,'0');
    $('seconds').value = String(Math.floor(value) % 60).padStart(2,'0');
  }
  timeState() {
    for (const id of ['hours','minutes','seconds']) $(id).disabled = this.busy || $('episode-state').value === 'watched';
  }
  normalize() {
    if (!this.entry) return 0;
    const value = clampTime($('hours').value, $('minutes').value, $('seconds').value, this.entry.duration);
    this.setTime(value); return value;
  }
  async save() {
    if (!this.entry || this.busy) return;
    const ctx = this.context(), serial = this.serial;
    const entry = {...this.entry};
    const seconds = this.normalize();
    const edit = {key:entry.key, watched:$('episode-state').value === 'watched', position_seconds:$('episode-state').value === 'unwatched' ? 0 : seconds};
    this.buttons(true); $('editor-message').textContent = 'Saving online…';
    try {
      const progress = await this.store.save(ctx.key, ctx.salt, edit, entry.expectedRevision, ctx.base);
      if (this.context().generation !== ctx.generation || this.serial !== serial) return;
      $('editor-dialog').close(); this.changed(progress);
    } catch (error) {
      if (this.context().generation === ctx.generation && this.serial === serial) $('editor-message').textContent = error.message;
    } finally { if (this.context().generation === ctx.generation && this.serial === serial) this.buttons(false); }
  }
}
function format(seconds) {
  seconds = Math.floor(seconds);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2,'0')).join(':');
}

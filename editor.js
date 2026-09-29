import {seal, openSealed} from './crypto.js?v=20260926-sync-1';
import {clampTime, episodeKey, uniqueEpisode} from './progress.js?v=20260926-sync-1';
import {readDVD} from './scanner.js?v=20260929-crop-1';
const $ = id => document.getElementById(id);
const tokenKey = `watchlist:${location.pathname}:editing`;
const TOKEN_AAD = 'watchlist-local-editing-token-v1';

export class Editor {
  constructor(store, context, changed) {
    this.store = store; this.context = context; this.changed = changed;
    this.busy = false; this.entry = null; this.serial = 0; this.editingShow = null;
    this.scanFile = null; this.previewBitmap = null; this.selection = null; this.dragStart = null;
    $('editing-setup').onclick = () => { $('setup-message').textContent = ''; $('token').value = ''; $('setup-dialog').showModal(); };
    $('setup-close').onclick = () => $('setup-dialog').close();
    $('forget-editing').onclick = () => {
      this.serial++; this.store.reset(); this.busy = false;
      try { localStorage.removeItem(tokenKey); } catch {}
      $('token').value = ''; this.status(); $('setup-message').textContent = 'Editing access forgotten on this device.';
    };
    $('setup-form').onsubmit = event => { event.preventDefault(); this.connect(); };
    $('editor-cancel').onclick = () => $('editor-dialog').close();
    $('editor-dialog').addEventListener('close', () => { this.serial++; this.entry = null; this.editingShow = null; this.clearPreview(); $('scan-message').textContent = ''; });
    $('editor-dialog').addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('setup-dialog').addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('edit-season').onchange = () => this.chooseSeason();
    $('edit-disc').onchange = () => this.chooseDisc();
    $('edit-episode').onchange = () => this.chooseEpisode();
    $('scan-button').onclick = () => $('scan-file').click();
    $('scan-file').onchange = async () => {
      const file = $('scan-file').files?.[0]; $('scan-file').value = '';
      if (file) { await this.showPreview(file); await this.scan(file); }
    };
    $('scan-area').onclick = () => { if (this.scanFile && this.selection) this.scan(this.scanFile, this.selection); };
    $('scan-clear').onclick = () => { this.selection = null; $('scan-area').disabled = true; this.drawPreview(); };
    const canvas = $('scan-canvas');
    canvas.onpointerdown = event => {
      if (!this.previewBitmap) return;
      canvas.setPointerCapture(event.pointerId);
      this.dragStart = this.point(event); this.selection = null; this.drawPreview();
    };
    canvas.onpointermove = event => {
      if (!this.dragStart) return;
      const end = this.point(event), start = this.dragStart;
      this.selection = {x:Math.min(start.x,end.x), y:Math.min(start.y,end.y), width:Math.abs(end.x-start.x), height:Math.abs(end.y-start.y)};
      this.drawPreview();
    };
    canvas.onpointerup = event => {
      if (!this.dragStart) return;
      canvas.onpointermove(event); this.dragStart = null;
      if (this.selection?.width < .025 || this.selection?.height < .01) this.selection = null;
      $('scan-area').disabled = !this.selection || this.scanBusy;
      this.drawPreview();
    };
    canvas.onpointercancel = () => { this.dragStart = null; };
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
    this.editingShow = null; $('edit-season').replaceChildren(); $('edit-episode').replaceChildren();
    $('edit-disc').replaceChildren(); this.clearPreview(); $('scan-message').textContent = '';
    $('editor-title').textContent = ''; $('editor-context').textContent = ''; $('duration-hint').textContent = '';
  }
  lock() { this.serial++; this.store.reset(); this.busy = false; this.close(); this.buttons(false); this.status(); }
  buttons(busy) {
    this.busy = busy;
    for (const id of ['editor-save','editor-cancel','setup-save','setup-close','forget-editing','episode-state','hours','minutes','seconds','token','remember-editing','edit-season','edit-disc','edit-episode','scan-button']) $(id).disabled = busy;
    $('scan-area').disabled = busy || this.scanBusy || !this.selection;
    $('scan-clear').disabled = busy || this.scanBusy;
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
  openShow(show) {
    if (!this.store.token) { $('setup-message').textContent = 'Connect editing once, then select Edit again.'; $('setup-dialog').showModal(); return; }
    this.editingShow = show;
    const select = $('edit-season'); select.replaceChildren();
    for (const season of show.seasons) {
      const option = document.createElement('option'); option.value = String(season.number); option.textContent = `Season ${season.number}`; select.append(option);
    }
    const currentSeason = show.seasons.find(season => (season.episodes || []).some(ep => ep.current)) || show.seasons.find(season => String(season.number) === String(show.season)) || show.seasons[0];
    select.value = String(currentSeason.number); this.chooseSeason();
    $('editor-dialog').showModal(); $('edit-episode').focus();
  }
  chooseSeason() {
    const season = this.editingShow.seasons.find(sn => String(sn.number) === $('edit-season').value);
    const discs = [...new Set((season.episodes || []).map(ep => ep.disc).filter(Number.isInteger))].sort((a,b) => a-b);
    const select = $('edit-disc'); select.replaceChildren();
    for (const disc of discs) {
      const option = document.createElement('option'); option.value = String(disc); option.textContent = `Disc ${String(disc).padStart(2,'0')}`; select.append(option);
    }
    if (!discs.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No disc'; select.append(option); }
    const current = (season.episodes || []).find(ep => ep.current);
    select.value = String(current?.disc ?? (discs.includes(this.editingShow.disc) ? this.editingShow.disc : discs[0] ?? ''));
    this.chooseDisc();
  }
  chooseDisc() {
    const season = this.editingShow.seasons.find(sn => String(sn.number) === $('edit-season').value);
    const select = $('edit-episode'); select.replaceChildren();
    for (const [index, ep] of (season.episodes || []).entries()) {
      if ($('edit-disc').value && String(ep.disc) !== $('edit-disc').value) continue;
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `${ep.disc_position != null ? `TRK ${ep.disc_position} · ` : ''}${ep.number != null ? `${ep.number} - ` : ''}${ep.title || 'Untitled episode'}`;
      select.append(option);
    }
    const currentIndex = (season.episodes || []).findIndex(ep => ep.current && (!$('edit-disc').value || String(ep.disc) === $('edit-disc').value));
    select.value = currentIndex >= 0 ? String(currentIndex) : select.options[0]?.value || '';
    this.chooseEpisode();
  }
  clearPreview() {
    this.previewBitmap?.close(); this.previewBitmap = null;
    this.scanFile = null; this.selection = null; this.dragStart = null;
    $('scan-preview').hidden = true; $('scan-area').disabled = true;
  }
  async showPreview(file) {
    this.clearPreview();
    this.scanFile = file;
    try {
      const bitmap = await createImageBitmap(file);
      if (this.scanFile !== file || !this.editingShow) { bitmap.close(); return; }
      this.previewBitmap = bitmap;
      const canvas = $('scan-canvas');
      const scale = Math.min(1, 760 / bitmap.width, 900 / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      $('scan-preview').hidden = false;
      this.drawPreview();
    } catch { $('scan-message').textContent = 'Preview unavailable; trying the automatic scan.'; }
  }
  point(event) {
    const box = $('scan-canvas').getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)), y:Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))};
  }
  drawPreview() {
    if (!this.previewBitmap) return;
    const canvas = $('scan-canvas'), ctx = canvas.getContext('2d');
    ctx.drawImage(this.previewBitmap,0,0,canvas.width,canvas.height);
    if (!this.selection || !this.selection.width || !this.selection.height) return;
    const {x,y,width,height} = this.selection;
    ctx.fillStyle = 'rgba(18, 17, 15, .38)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(this.previewBitmap, x*this.previewBitmap.width, y*this.previewBitmap.height, width*this.previewBitmap.width, height*this.previewBitmap.height, x*canvas.width,y*canvas.height,width*canvas.width,height*canvas.height);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.strokeRect(x*canvas.width,y*canvas.height,width*canvas.width,height*canvas.height);
  }
  async scan(file, crop = null) {
    if (!this.editingShow || this.busy || this.scanBusy) return;
    const serial = this.serial, show = this.editingShow;
    this.scanBusy = true; $('scan-button').disabled = true; $('scan-area').disabled = true; $('scan-clear').disabled = true;
    $('scan-message').textContent = crop ? 'Reading selected area on this device…' : 'Reading DVD screen on this device…';
    try {
      const result = await readDVD(file, crop);
      if (this.serial !== serial || this.editingShow !== show) return;
      const season = show.seasons.find(sn => String(sn.number) === $('edit-season').value);
      const disc = $('edit-disc').value;
      const matches = (season.episodes || []).map((ep,index) => ({ep,index})).filter(({ep}) => String(ep.disc) === disc && Number(ep.disc_position) === result.track);
      if (matches.length === 1) {
        $('edit-episode').value = String(matches[0].index); this.chooseEpisode();
      }
      if (result.time) {
        const [h,m,s] = result.time.split(':').map(Number);
        this.setTime(h * 3600 + m * 60 + s); $('episode-state').value = 'progress'; this.timeState();
      }
      $('scan-message').textContent = `${result.track ? `TRK ${result.track}${result.total ? `/${result.total}` : ''}` : 'Track unreadable'} · ${result.time || 'Time unreadable'}. ${matches.length === 1 ? 'Episode selected.' : result.track ? `No unique matching track on Disc ${disc || '—'} in this season; choose the episode manually.` : 'Choose the episode manually.'} ${(!result.track || !result.time) && !crop ? 'Drag over the status bar and rescan. ' : ''}Review before saving.`;
    } catch (error) {
      if (this.serial === serial && this.editingShow === show) $('scan-message').textContent = `Could not read this photo: ${error.message}. Try selecting the top status bar.`;
    } finally {
      this.scanBusy = false;
      if (this.serial === serial && this.editingShow === show) {
        $('scan-button').disabled = this.busy; $('scan-area').disabled = this.busy || !this.selection; $('scan-clear').disabled = this.busy;
      }
    }
  }
  chooseEpisode() {
    const show = this.editingShow;
    const season = show.seasons.find(sn => String(sn.number) === $('edit-season').value);
    const episode = (season.episodes || [])[Number($('edit-episode').value)];
    this.entry = null; this.buttons(false);
    $('editor-title').textContent = 'Edit progress';
    $('editor-context').textContent = show.name;
    $('editor-message').textContent = '';
    if (!episode || !uniqueEpisode(this.context().base, episodeKey(show, season, episode))) {
      this.setTime(0); $('editor-save').disabled = true;
      $('duration-hint').textContent = '';
      $('editor-message').textContent = 'This episode has no unique identity. Choose another episode, or give it a unique title in the desktop app.';
      return;
    }
    const ctx = this.context(), key = episodeKey(show, season, episode);
    this.entry = {key, duration:episode.duration_seconds, expectedRevision:ctx.progress.edits.find(item => item.key === key)?.revision || null};
    $('hours').maxLength = Number.isFinite(episode.duration_seconds) && episode.duration_seconds > 0 ? Math.max(2, String(Math.floor(episode.duration_seconds / 3600)).length) : 5;
    $('episode-state').value = episode.watched ? 'watched' : episode.position_seconds > 0 ? 'progress' : 'unwatched';
    this.setTime(episode.position_seconds || 0); this.timeState();
    $('duration-hint').textContent = episode.duration_seconds > 0 ? `Length: ${format(episode.duration_seconds)}. Times beyond the end adjust to this length.` : 'Length unknown. Enter where you stopped.';
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

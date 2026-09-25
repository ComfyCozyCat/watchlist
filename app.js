import {deriveKey, decrypt, validateEnvelope, encode64, decode64} from './crypto.js?v=20260925-edit-1';
import {ProgressStore, emptyProgress, applyProgress, episodeKey, episodeIndex} from './progress.js?v=20260925-edit-1';
import {Editor} from './editor.js?v=20260925-edit-1';

const $ = id => document.getElementById(id);
const storageKey = `watchlist:${location.pathname}:unlock`;
let envelope, activeKey, activeSalt, snapshot;
let loading = false;
let baseSnapshot, progress = emptyProgress(), editableEpisodes = new Map();
const store = new ProgressStore();
const editor = new Editor(store, () => ({key:activeKey, salt:activeSalt, generation:accessGeneration, base:baseSnapshot, progress}), value => {
  progress = value; snapshot = applyProgress(baseSnapshot, progress); renderUnlocked();
  $('refresh-message').textContent = 'Saved online. Your other browsers will see it when refreshed.';
});
const browseViews = new Map();
let accessGeneration = 0;
function storageRead() { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } }
function storageClear() { try { localStorage.removeItem(storageKey); } catch {} }
function lock(message = '') {
  accessGeneration++;
  browseViews.clear();
  editor.lock(); baseSnapshot = null; progress = emptyProgress();
  activeKey = null; activeSalt = null; snapshot = null;
  $('shows').replaceChildren(); $('library').hidden = true; $('lock').hidden = true; $('unlock').hidden = false;
  $('password').value = ''; $('message').textContent = message;
  $('password').type = 'password'; $('reveal').textContent = 'Show'; $('reveal').setAttribute('aria-label','Show password');
  $('search').value = ''; $('updated').textContent = ''; $('count').textContent = ''; $('refresh-message').textContent = '';
}
function clock(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}` : `${minutes}:${String(rest).padStart(2,'0')}`;
}
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function render() {
  if (!snapshot) return;
  editableEpisodes = episodeIndex(baseSnapshot);
  const query = $('search').value.trim().toLocaleLowerCase();
  const shows = snapshot.shows.filter(show => String(show.name).toLocaleLowerCase().includes(query));
  $('shows').replaceChildren();
  shows.forEach((show,index) => {
    const row = element('article','show','');
    row.append(element('span','show-number',String(index+1).padStart(2,'0')));
    const detail = element('div','show-detail','');
    detail.append(element('h2','',show.name));
    const episode = [show.season ? `Season ${show.season}` : '', show.disc ? `Disc ${String(show.disc).padStart(2,'0')} · ${show.disc_position} - ${show.episode}` : show.episode].filter(Boolean).join(' · ');
    detail.append(element('p','episode',show.status === 'caught_up' ? `Last watched: ${episode}` : episode || 'Nothing started yet'));
    row.append(detail);
    const meta = element('div','show-meta','');
    const label = show.status === 'resume' ? 'Resume' : show.status === 'next' ? 'Next up' : show.status === 'caught_up' ? 'Saved episodes watched' : 'Not started';
    meta.append(element('span',`badge ${show.status === 'next' ? 'next' : show.status === 'resume' ? '' : 'other'}`,label));
    if (show.status === 'resume') meta.append(element('span','position',clock(show.position_seconds)));
    row.append(meta);
    if (Array.isArray(show.seasons) && show.seasons.length) row.append(episodeBrowser(show));
    $('shows').append(row);
  });
  $('count').textContent = `${snapshot.shows.length} ${snapshot.shows.length === 1 ? 'SHOW' : 'SHOWS'} ON YOUR LIST`;
  $('empty').hidden = shows.length > 0;
  $('empty').textContent = query ? 'No matching shows.' : 'No shows here yet. Add a favorite in the dashboard, then sync.';
  const latest = [snapshot.updated_at, progress.updated_at].filter(Boolean).sort().at(-1);
  const updated = new Date(latest);
  $('updated').textContent = Number.isNaN(updated.getTime()) ? 'Last update unavailable' : `Updated ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(updated)}`;
  $('unlock').hidden = true; $('library').hidden = false; $('lock').hidden = false;
}
function renderUnlocked() {
  try {
    render();
  } catch {
    storageClear();
    lock('Your password worked, but the page couldn’t display your list. Reload this page and try again.');
  }
}
async function fetchEnvelope() {
  const response = await fetch('./watchlist-data.json', {cache:'no-store'});
  if (!response.ok) throw new Error('Snapshot unavailable');
  const next = await response.json(); validateEnvelope(next); return next;
}
async function acceptSnapshot(result, key, salt, generation) {
  if (generation !== accessGeneration) return;
  if (activeSalt !== salt) progress = emptyProgress();
  baseSnapshot = result; activeKey = key; activeSalt = salt;
  await editor.restore();
  if (generation !== accessGeneration) return;
  let warning = '';
  try {
    const remote = await store.readProgress(key, salt);
    if (generation !== accessGeneration) return;
    progress = remote.value;
  } catch (error) { warning = `Website progress couldn’t refresh. ${error.message}`; }
  if (generation !== accessGeneration) return;
  snapshot = applyProgress(baseSnapshot, progress); renderUnlocked();
  if (generation === accessGeneration) $('refresh-message').textContent = warning;
}
async function load() {
  if (loading || editor.isOpen() || editor.busy) return;
  loading = true;
  const generation = accessGeneration;
  try {
    if (!crypto.subtle) throw new Error('Secure browser needed');
    const next = await fetchEnvelope();
    if (generation !== accessGeneration) return;
    envelope = next;
    $('unlock-button').disabled = false;
    const remembered = storageRead();
    let key = activeSalt === envelope.salt ? activeKey : null;
    if (!key && remembered?.salt === envelope.salt) {
      try { key = await crypto.subtle.importKey('raw', decode64(remembered.key), {name:'AES-GCM'}, true, ['decrypt']); } catch { storageClear(); }
    }
    if (key) {
      try {
        const result = await decrypt(next,key);
        if (generation !== accessGeneration) return;
        await acceptSnapshot(result, key, next.salt, generation);
      } catch { if (generation === accessGeneration) { storageClear(); lock('Please unlock your list again.'); } }
    } else {
      if (generation !== accessGeneration) return;
      const wasUnlocked = Boolean(activeKey);
      lock(wasUnlocked ? 'The password changed. Enter the new password to continue.' : '');
      if (remembered && remembered.salt !== envelope.salt) storageClear();
    }
  } catch {
    if (generation !== accessGeneration) return;
    if (snapshot) $('refresh-message').textContent = 'Couldn’t refresh. You’re still viewing the last loaded update.';
    else { lock('Your list isn’t available yet. Try again after the dashboard syncs.'); $('unlock-button').disabled = true; }
  } finally { loading = false; }
}
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!envelope) return;
  const generation = ++accessGeneration;
  const unlockingEnvelope = envelope;
  const remember = $('remember').checked;
  $('unlock-button').disabled = true; $('message').textContent = 'Opening your list…';
  try {
    const key = await deriveKey($('password').value, unlockingEnvelope.salt);
    const result = await decrypt(unlockingEnvelope,key);
    const rememberedKey = remember ? encode64(await crypto.subtle.exportKey('raw',key)) : null;
    if (generation !== accessGeneration) return;
    storageClear();
    if (remember) {
      try { localStorage.setItem(storageKey,JSON.stringify({salt:unlockingEnvelope.salt,key:rememberedKey})); } catch {}
    }
    $('password').value = ''; $('message').textContent = '';
    await acceptSnapshot(result, key, unlockingEnvelope.salt, generation);
  } catch { if (generation === accessGeneration) $('message').textContent = 'That password didn’t unlock the list. Please try again.'; }
  finally { $('unlock-button').disabled = false; }
});
$('reveal').addEventListener('click',() => { const show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password'; $('reveal').textContent = show ? 'Hide' : 'Show'; $('reveal').setAttribute('aria-label',show ? 'Hide password' : 'Show password'); });
$('lock').addEventListener('click',() => { storageClear(); lock(); $('password').focus(); });
window.addEventListener('storage',event => {
  if ((event.key === storageKey || event.key === null) && event.newValue === null) lock();
});
$('search').addEventListener('input',render);
$('refresh').addEventListener('click',load);
document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') load(); });
load();

function episodeBrowser(show) {
  const view = browseViews.get(show.name) || {season: show.season || String(show.seasons[0].number), disc: '', grouped: false, relative: false, open: false};
  browseViews.set(show.name, view);
  const browser = element('details', 'episode-browser', '');
  browser.open = view.open;
  const summary = element('summary', '', 'Browse episodes');
  browser.append(summary);
  const controls = element('div', 'episode-controls', '');
  function selector(label, options, selected) {
    const wrapper = element('label', '', label);
    const select = element('select', '', '');
    select.setAttribute('aria-label', label);
    options.forEach(([value, title]) => { const option = element('option', '', title); option.value = value; select.append(option); });
    select.value = selected;
    wrapper.append(select); controls.append(wrapper);
    return select;
  }
  const seasons = selector('Season', [['', 'All seasons'], ...show.seasons.map(s => [String(s.number), `Season ${s.number}`])], view.season);
  const discs = selector('Disc', [['', 'All discs']], '');
  function toggle(label, checked) {
    const wrapper = element('label', 'episode-toggle', '');
    const input = element('input', '', ''); input.type = 'checkbox'; input.checked = checked;
    wrapper.append(input, document.createTextNode(label)); controls.append(wrapper);
    return input;
  }
  const grouped = toggle('Group by disc', view.grouped);
  const relative = toggle('Disc numbering', view.relative);
  browser.append(controls);
  const scroller = element('div', 'episode-scroll', '');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', `${show.name} episodes`);
  browser.append(scroller);
  function selectedSeasons() { return show.seasons.filter(s => !view.season || String(s.number) === view.season); }
  function updateDiscs() {
    const values = [...new Set(selectedSeasons().flatMap(s => s.episodes || []).map(ep => ep.disc).filter(Number.isInteger))].sort((a,b) => a-b);
    discs.replaceChildren();
    const all = element('option', '', 'All discs'); all.value = ''; discs.append(all);
    values.forEach(d => { const option = element('option', '', `Disc ${String(d).padStart(2,'0')}`); option.value = String(d); discs.append(option); });
    if (!values.some(d => String(d) === view.disc)) view.disc = '';
    discs.value = view.disc;
    discs.disabled = relative.disabled = grouped.disabled = values.length === 0;
  }
  function focusCurrent() {
    if (!browser.open) return;
    const current = scroller.querySelector('[aria-current="true"]');
    if (current && scroller.scrollHeight > scroller.clientHeight) {
      scroller.scrollTop += current.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 3;
    }
  }
  function draw() {
    const table = element('table', 'episode-table', '');
    const head = document.createElement('thead');
    const headers = document.createElement('tr');
    ['Episode', 'Progress', 'Length'].forEach(label => { const th = element('th', '', label); th.scope = 'col'; headers.append(th); });
    head.append(headers); table.append(head);
    const body = document.createElement('tbody');
    let count = 0;
    selectedSeasons().forEach(season => {
      let lastGroup = null;
      const episodes = (season.episodes || []).filter(ep => !view.disc || String(ep.disc) === view.disc);
      if (view.grouped) episodes.sort((a,b) => (a.disc || Infinity) - (b.disc || Infinity) || (a.disc_position || 0) - (b.disc_position || 0));
      episodes.forEach((ep) => {
        const context = [`Season ${season.number}`, ep.disc ? `Disc ${String(ep.disc).padStart(2,'0')}` : 'Ungrouped'].join(' · ');
        if (view.grouped && context !== lastGroup) {
          const heading = element('tr', 'disc-heading', '');
          const cell = element('th', '', context); cell.colSpan = 3; cell.scope = 'rowgroup'; heading.append(cell); body.append(heading); lastGroup = context;
        }
        const row = element('tr', ep.current ? 'current-episode' : '', '');
        if (ep.current) row.setAttribute('aria-current', 'true');
        const number = view.relative && ep.disc ? ep.disc_position : (ep.number ?? ep.sequence_number);
        const label = `${number != null ? `${number} - ` : ''}${ep.title || 'Untitled episode'}`;
        const title = element('td', 'episode-title', label);
        const hints = [];
        if (!view.season && !view.grouped) hints.push(`Season ${season.number}`);
        if (ep.disc && !view.disc && !view.grouped) hints.push(`Disc ${String(ep.disc).padStart(2,'0')}`);
        if (ep.available === false) hints.push('Unavailable');
        if (ep.current) hints.push(show.status === 'resume' ? 'Resume' : show.status === 'caught_up' ? 'Last watched' : 'Next up');
        if (hints.length) title.append(element('small', '', hints.join(' · ')));
        const edit = element('button', 'episode-edit', 'Edit');
        edit.type = 'button'; edit.setAttribute('aria-label', `Edit ${label}`);
        edit.disabled = !editableEpisodes.get(episodeKey(show, season, ep));
        if (edit.disabled) edit.title = 'This episode has an ambiguous identity. Give it a unique title in the desktop app first.';
        edit.addEventListener('click', () => editor.open(show, season, ep, label));
        title.append(edit);
        row.append(title, element('td', '', ep.watched ? 'Watched' : ep.position_seconds != null ? clock(ep.position_seconds) : '—'), element('td', '', ep.duration_seconds != null ? clock(ep.duration_seconds) : '—'));
        body.append(row); count++;
      });
    });
    table.append(body); scroller.replaceChildren(count ? table : element('p', 'empty', 'No episodes in this selection.'));
    requestAnimationFrame(focusCurrent);
  }
  seasons.addEventListener('change', () => { view.season = seasons.value; view.disc = ''; updateDiscs(); draw(); });
  discs.addEventListener('change', () => { view.disc = discs.value; draw(); });
  grouped.addEventListener('change', () => { view.grouped = grouped.checked; draw(); });
  relative.addEventListener('change', () => { view.relative = relative.checked; draw(); });
  browser.addEventListener('toggle', () => { view.open = browser.open; if (browser.open) requestAnimationFrame(focusCurrent); });
  updateDiscs(); draw();
  return browser;
}

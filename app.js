import {deriveKey, decrypt, validateEnvelope, encode64, decode64} from './crypto.js';

const $ = id => document.getElementById(id);
const storageKey = `watchlist:${location.pathname}:unlock`;
let envelope, activeKey, activeSalt, snapshot;
let loading = false;
let accessGeneration = 0;
function storageRead() { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } }
function storageClear() { try { localStorage.removeItem(storageKey); } catch {} }
function lock(message = '') {
  accessGeneration++;
  activeKey = null; activeSalt = null; snapshot = null;
  $('shows').replaceChildren(); $('library').hidden = true; $('lock').hidden = true; $('unlock').hidden = false;
  $('password').value = ''; $('subtitle').textContent = 'Your shows, saved for later.'; $('message').textContent = message;
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
  const query = $('search').value.trim().toLocaleLowerCase();
  const shows = snapshot.shows.filter(show => String(show.name).toLocaleLowerCase().includes(query));
  $('shows').replaceChildren();
  shows.forEach((show,index) => {
    const row = element('article','show','');
    row.append(element('span','show-number',String(index+1).padStart(2,'0')));
    const detail = element('div','show-detail','');
    detail.append(element('h2','',show.name));
    const episode = [show.season ? `Season ${show.season}` : '', show.episode].filter(Boolean).join(' · ');
    detail.append(element('p','episode',show.status === 'caught_up' ? `Last watched: ${episode}` : episode || 'Nothing started yet'));
    row.append(detail);
    const meta = element('div','show-meta','');
    const label = show.status === 'resume' ? 'Resume' : show.status === 'next' ? 'Next up' : show.status === 'caught_up' ? 'Saved episodes watched' : 'Not started';
    meta.append(element('span',`badge ${show.status === 'next' ? 'next' : show.status === 'resume' ? '' : 'other'}`,label));
    if (show.status === 'resume') meta.append(element('span','position',clock(show.position_seconds)));
    row.append(meta); $('shows').append(row);
  });
  $('count').textContent = `${snapshot.shows.length} ${snapshot.shows.length === 1 ? 'SHOW' : 'SHOWS'} ON YOUR LIST`;
  $('empty').hidden = shows.length > 0;
  $('empty').textContent = query ? 'No matching shows.' : 'No shows here yet. Add a favorite in the dashboard, then sync.';
  const updated = new Date(snapshot.updated_at);
  $('updated').textContent = Number.isNaN(updated.getTime()) ? 'Last update unavailable' : `Updated ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(updated)}`;
  $('subtitle').textContent = 'One small reminder. Then back to the story.';
  $('unlock').hidden = true; $('library').hidden = false; $('lock').hidden = false;
}
async function fetchEnvelope() {
  const response = await fetch('./watchlist-data.json', {cache:'no-store'});
  if (!response.ok) throw new Error('Snapshot unavailable');
  const next = await response.json(); validateEnvelope(next); return next;
}
async function load() {
  if (loading) return;
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
        snapshot = result; activeKey = key; activeSalt = next.salt; render(); $('refresh-message').textContent = '';
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
    activeKey = key; activeSalt = unlockingEnvelope.salt; snapshot = result;
    storageClear();
    if (remember) {
      try { localStorage.setItem(storageKey,JSON.stringify({salt:unlockingEnvelope.salt,key:rememberedKey})); } catch {}
    }
    $('password').value = ''; $('message').textContent = ''; render();
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

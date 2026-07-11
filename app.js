const state = { bpm: Number(localStorage.getItem('bpm') || 120), playing: false, library: [], playlistId: null, audio: null, timer: null, nextBeat: 0, installPrompt: null, deleteTrackId: null };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('show'), 1800); }
async function api(path, options = {}) { const response = await fetch(path, { headers: {'Content-Type':'application/json'}, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Errore'); return data; }
async function loadLibrary() { state.library = await api('/api/library'); if (!state.playlistId || !state.library.some(p => p.id === state.playlistId)) state.playlistId = state.library[0]?.id || null; render(); }
function currentPlaylist() { return state.library.find(p => p.id === state.playlistId); }
const solidIcon = {
  play: '<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M64 32c-18 0-32 14-32 32v384c0 18 14 32 32 32 7 0 13-2 19-6l272-192c9-6 13-16 13-26s-4-20-13-26L83 38c-6-4-12-6-19-6z"/></svg>',
  edit: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M471 17c-23-23-60-23-83 0L364 41l107 107 24-24c23-23 23-60 0-83l-24-24zM344 61 54 351c-6 6-10 13-12 21L1 484c-3 8-1 17 5 23s15 8 23 5l112-41c8-2 15-6 21-12l289-290L344 61z"/></svg>',
  trash: '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M136 17C140 7 150 0 161 0h126c11 0 21 7 25 17l11 31h77c13 0 24 11 24 24s-11 24-24 24H48C35 96 24 85 24 72s11-24 24-24h77l11-31zm-88 95h352l-16 354c-1 26-22 46-48 46H112c-26 0-47-20-48-46L48 112z"/></svg>'
};

function setBpm(value) {
  state.bpm = Math.max(20, Math.min(300, Math.round(Number(value) || 120)));
  $('#bpmInput').value = state.bpm; $('#bpmSlider').value = state.bpm;
  $('#bpmSlider').style.setProperty('--fill', `${(state.bpm - 20) / 280 * 100}%`);
  localStorage.setItem('bpm', state.bpm);
}
function click() {
  const ctx = state.audio; if (!ctx) return;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = 1100; gain.gain.setValueAtTime(.22, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .045);
  osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .05);
  const pulse = $('#pulse'); pulse.classList.remove('beat'); requestAnimationFrame(() => pulse.classList.add('beat'));
}
function schedule() { if (!state.playing) return; click(); state.timer = setTimeout(schedule, 60000 / state.bpm); }
function togglePlay() {
  state.playing = !state.playing; const button = $('#playButton'); button.classList.toggle('playing', state.playing); button.ariaLabel = state.playing ? 'Pausa metronomo' : 'Avvia metronomo';
  if (state.playing) { state.audio ||= new (window.AudioContext || window.webkitAudioContext)(); state.audio.resume(); schedule(); }
  else clearTimeout(state.timer);
}
function useTrack(track) { setBpm(track.bpm); location.hash = 'player'; showScreen('player'); toast(`${track.title} · ${track.bpm} BPM`); }

function render() {
  const playlist = currentPlaylist();
  $('#activePlaylistName').textContent = playlist?.name || 'Nessuna playlist'; $('#libraryPlaylistName').textContent = playlist?.name || '—';
  $('#trackCount').textContent = `${playlist?.tracks.length || 0} BRANI`;
  $('#playlistList').innerHTML = state.library.map(p => `<button class="playlist-item ${p.id===state.playlistId?'active':''}" data-playlist="${p.id}"><b>${escapeHtml(p.name)}</b><span>${p.tracks.length}</span></button>`).join('');
  const empty = '<div class="empty">Nessun brano in questa playlist.</div>';
  $('#playerTrackList').innerHTML = playlist?.tracks.length ? playlist.tracks.map(t => `<div class="compact-track ${t.bpm===state.bpm?'active':''}" data-use="${t.id}"><b>${escapeHtml(t.title)}</b><span>${t.bpm} BPM</span></div>`).join('') : empty;
  $('#libraryTrackList').innerHTML = playlist?.tracks.length ? playlist.tracks.map((t,i) => `<div class="track-row"><div class="track-main"><span class="track-number">${String(i+1).padStart(2,'0')}</span><b>${escapeHtml(t.title)}</b></div><span class="track-artist">${escapeHtml(t.artist)||'—'}</span><span class="track-bpm">${t.bpm}</span><div class="row-actions"><button class="action-use" data-use="${t.id}" title="Usa BPM" aria-label="Usa BPM di ${escapeHtml(t.title)}">${solidIcon.play}</button><button class="action-edit" data-edit="${t.id}" title="Modifica" aria-label="Modifica ${escapeHtml(t.title)}">${solidIcon.edit}</button><button class="action-delete" data-delete="${t.id}" title="Elimina" aria-label="Elimina ${escapeHtml(t.title)}">${solidIcon.trash}</button></div></div>`).join('') : empty;
}
function escapeHtml(s='') { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function findTrack(id) { return currentPlaylist()?.tracks.find(t => t.id === Number(id)); }
function showScreen(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id===id)); $$('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.screen===id)); }
function openTrack(track) { const form=$('#trackForm'); form.reset(); form.elements.id.value=track?.id||''; form.elements.title.value=track?.title||''; form.elements.artist.value=track?.artist||''; form.elements.bpm.value=track?.bpm||state.bpm; $('#trackDialogTitle').textContent=track?'Modifica brano':'Nuovo brano'; $('#trackDialog').showModal(); }
function openPlaylistDialog() { const form=$('#playlistForm'); form.reset(); $('#playlistDialog').showModal(); requestAnimationFrame(()=>form.elements.name.focus()); }
function openDeleteDialog(track) { state.deleteTrackId=track.id; $('#deleteTrackName').textContent=track.title; $('#deleteDialog').showModal(); }
function closeDeleteDialog() { state.deleteTrackId=null; $('#deleteDialog').close(); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function installDismissedRecently() { const dismissed=Number(localStorage.getItem('installDismissedAt')||0); return Date.now()-dismissed < 7*24*60*60*1000; }
function showInstallBanner() { if(isStandalone()||installDismissedRecently()) return; const banner=$('#installBanner'); banner.hidden=false; requestAnimationFrame(()=>banner.classList.add('visible')); }
function hideInstallBanner(remember=false) { const banner=$('#installBanner'); banner.classList.remove('visible'); if(remember)localStorage.setItem('installDismissedAt',Date.now()); setTimeout(()=>banner.hidden=true,450); }

$('#bpmSlider').addEventListener('input', e => setBpm(e.target.value));
$('#bpmInput').addEventListener('change', e => setBpm(e.target.value));
$('#bpmInput').addEventListener('focus', e => e.target.select());
$('#playButton').addEventListener('click', togglePlay);
$$('.step').forEach(b => b.addEventListener('click', () => setBpm(state.bpm + Number(b.dataset.delta))));
$$('.bottom-nav a').forEach(a => a.addEventListener('click', () => showScreen(a.dataset.screen)));
$('#openTracks').addEventListener('click', () => { location.hash='tracks'; showScreen('tracks'); });
$('#newTrackButton').addEventListener('click', () => state.playlistId ? openTrack() : toast('Crea prima una playlist'));
$('#newPlaylistButton').addEventListener('click',openPlaylistDialog);
document.addEventListener('click', async e => {
  const playlist=e.target.closest('[data-playlist]'); if(playlist){state.playlistId=Number(playlist.dataset.playlist);render();return;}
  const use=e.target.closest('[data-use]'); if(use){const t=findTrack(use.dataset.use);if(t)useTrack(t);return;}
  const edit=e.target.closest('[data-edit]'); if(edit){openTrack(findTrack(edit.dataset.edit));return;}
  const del=e.target.closest('[data-delete]'); if(del){const track=findTrack(del.dataset.delete);if(track)openDeleteDialog(track);}
});
$('#trackForm').addEventListener('submit', async e => { e.preventDefault(); const f=new FormData(e.target), id=f.get('id'); const body={title:f.get('title'),artist:f.get('artist'),bpm:Number(f.get('bpm')),playlist_id:state.playlistId}; try{await api(id?`/api/tracks/${id}`:'/api/tracks',{method:id?'PUT':'POST',body:JSON.stringify(body)});$('#trackDialog').close();await loadLibrary();toast(id?'Brano aggiornato':'Brano aggiunto');}catch(err){toast(err.message);} });
$('#playlistForm').addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.target).get('name')?.trim();if(!name)return;try{const playlist=await api('/api/playlists',{method:'POST',body:JSON.stringify({name})});state.playlistId=playlist.id;$('#playlistDialog').close();await loadLibrary();toast('Playlist creata');}catch(error){toast(error.message);}});
$$('#trackDialog .dialog-close,#trackForm .cancel-button').forEach(b=>b.addEventListener('click',()=>$('#trackDialog').close()));
$('#closePlaylistDialog').addEventListener('click',()=>$('#playlistDialog').close());
$('#cancelPlaylist').addEventListener('click',()=>$('#playlistDialog').close());
$('#cancelDelete').addEventListener('click',closeDeleteDialog);
$('#confirmDelete').addEventListener('click',async()=>{if(!state.deleteTrackId)return;const id=state.deleteTrackId;try{await api(`/api/tracks/${id}`,{method:'DELETE'});closeDeleteDialog();await loadLibrary();toast('Brano eliminato');}catch(error){toast(error.message);}});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;showInstallBanner();});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;hideInstallBanner();toast('BPM Studio installata');});
$('#installButton').addEventListener('click',async()=>{
  if(state.installPrompt){state.installPrompt.prompt();const result=await state.installPrompt.userChoice;if(result.outcome==='accepted')hideInstallBanner();state.installPrompt=null;return;}
  if(/iphone|ipad|ipod/i.test(navigator.userAgent)){$('#installMessage').textContent='Tocca Condividi, poi “Aggiungi alla schermata Home”.';toast('Condividi → Aggiungi alla schermata Home');return;}
  toast('Apri il menu del browser e scegli “Installa app”');
});
$('#dismissInstall').addEventListener('click',()=>hideInstallBanner(true));
window.addEventListener('hashchange',()=>showScreen(location.hash==='#tracks'?'tracks':'player'));
setBpm(state.bpm); showScreen(location.hash==='#tracks'?'tracks':'player'); loadLibrary().catch(()=>toast('Server non raggiungibile'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=7', {updateViaCache:'none'});
if(!isStandalone()&&/iphone|ipad|ipod/i.test(navigator.userAgent))setTimeout(showInstallBanner,1200);

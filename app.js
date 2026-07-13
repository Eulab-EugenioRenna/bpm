const METER_BEATS={'OFF':1,'2/4':2,'3/4':3,'4/4':4,'6/8':2};
const savedMeter=localStorage.getItem('meter');
const state = { bpm: Number(localStorage.getItem('bpm') || 120), meter:METER_BEATS[savedMeter]?savedMeter:'4/4', subdivisionMode: Math.max(1,Math.min(4,Number(localStorage.getItem('subdivisionMode')||1))), subdivision: 0, selectedTrackId: null, tapTimes: [], playing: false, library: [], songs: [], songQuery: '', songMatches: [], playlistId: null, audio: null, scheduler: null, resumeGeneration: 0, scheduledSources: new Map(), pulseQueue: [], pulseFrame: null, pulseAnimation: null, pulseFallbackTimer: null, installPrompt: null, deleteTrackId: null, deletePlaylistId: null, clientId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, syncTimer: null };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('show'), 1800); }
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: {'Content-Type':'application/json','X-Client-ID':state.clientId,...options.headers} }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Errore'); return data; }
async function loadLibrary() { [state.library,state.songs]=await Promise.all([api('/api/library'),api('/api/songs')]); if (!state.playlistId || !state.library.some(p => p.id === state.playlistId)) state.playlistId = state.library[0]?.id || null; render(); }
function currentPlaylist() { return state.library.find(p => p.id === state.playlistId); }
const solidIcon = {
  play: '<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M64 32c-18 0-32 14-32 32v384c0 18 14 32 32 32 7 0 13-2 19-6l272-192c9-6 13-16 13-26s-4-20-13-26L83 38c-6-4-12-6-19-6z"/></svg>',
  edit: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M471 17c-23-23-60-23-83 0L364 41l107 107 24-24c23-23 23-60 0-83l-24-24zM344 61 54 351c-6 6-10 13-12 21L1 484c-3 8-1 17 5 23s15 8 23 5l112-41c8-2 15-6 21-12l289-290L344 61z"/></svg>',
  trash: '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M136 17C140 7 150 0 161 0h126c11 0 21 7 25 17l11 31h77c13 0 24 11 24 24s-11 24-24 24H48C35 96 24 85 24 72s11-24 24-24h77l11-31zm-88 95h352l-16 354c-1 26-22 46-48 46H112c-26 0-47-20-48-46L48 112z"/></svg>'
};

function setBpm(value, trackId=null) {
  state.bpm = Math.max(20, Math.min(300, Math.round(Number(value) || 120)));
  state.selectedTrackId=trackId;
  $('#bpmInput').value = state.bpm; $('#bpmSlider').value = state.bpm;
  $('#bpmSlider').style.setProperty('--fill', `${(state.bpm - 20) / 280 * 100}%`);
  $$('.compact-track').forEach(pad=>pad.classList.toggle('active',Number(pad.dataset.use)===state.selectedTrackId));
  localStorage.setItem('bpm', state.bpm);
  if(state.playing&&state.scheduler){const now=state.audio.currentTime;state.scheduledSources.forEach((time,source)=>{if(time>now){try{source.stop();}catch{}state.scheduledSources.delete(source);}});state.pulseQueue=state.pulseQueue.filter(pulse=>pulse.time<=now);state.scheduler.retime();}
}
function animatePulse(level='primary') {
  const pulse=$('#pulse'),dot=pulse.querySelector('span'),interval=60000/state.bpm/state.subdivisionMode,durations={primary:150,beat:125,subdivision:100},duration=Math.min(durations[level],Math.max(30,interval*.68)),visuals={primary:{scale:2.15,color:'#c7ff39',shadow:'0 0 35px #c7ff39'},beat:{scale:1.78,color:'#a9d54b',shadow:'0 0 24px #a9d54baa'},subdivision:{scale:1.45,color:'#a5aa9c',shadow:'0 0 16px #a5aa9c88'}},visual=visuals[level];
  state.pulseAnimation?.cancel();clearTimeout(state.pulseFallbackTimer);pulse.classList.remove('beat','secondary');
  if(typeof dot.animate==='function'){
    state.pulseAnimation=dot.animate([
      {transform:`scale(${visual.scale})`,background:visual.color,boxShadow:visual.shadow},
      {transform:'scale(1)',background:'#30352d',boxShadow:'0 0 0 #0000'}
    ],{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
    state.pulseAnimation.onfinish=()=>{state.pulseAnimation=null;};
    return;
  }
  pulse.classList.toggle('secondary',level!=='primary');void dot.offsetWidth;pulse.classList.add('beat');state.pulseFallbackTimer=setTimeout(()=>pulse.classList.remove('beat','secondary'),duration);
}
function drawScheduledPulses() {
  if(!state.playing){state.pulseFrame=null;return;}
  while(state.pulseQueue.length&&state.pulseQueue[0].time<=state.audio.currentTime+.008)animatePulse(state.pulseQueue.shift().level);
  state.pulseFrame=requestAnimationFrame(drawScheduledPulses);
}
function click(level='primary',time=state.audio?.currentTime) {
  const ctx = state.audio; if (!ctx) return;
  const sounds={primary:{frequency:1380,gain:.50,duration:.065},beat:{frequency:1020,gain:.32,duration:.05},subdivision:{frequency:720,gain:.20,duration:.04}},sound=sounds[level],osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.frequency.value=sound.frequency;gain.gain.setValueAtTime(sound.gain,time);gain.gain.exponentialRampToValueAtTime(.001,time+sound.duration-.005);
  osc.connect(gain).connect(ctx.destination);osc.start(time);osc.stop(time+sound.duration);state.scheduledSources.set(osc,time);osc.onended=()=>state.scheduledSources.delete(osc);
  state.pulseQueue.push({level,time});
}
function startScheduler() {
  if(!state.playing||!state.audio||document.hidden)return;
  state.scheduler ||= new AudioClockScheduler({currentTime:()=>state.audio.currentTime,interval:()=>60/state.bpm/state.subdivisionMode});
  state.scheduler.stop();state.scheduledSources.forEach((_,source)=>{try{source.stop();}catch{}});state.scheduledSources.clear();state.pulseQueue=[];
  state.scheduler.start((time,subdivision)=>{const positionInBeat=subdivision%state.subdivisionMode,beatIndex=Math.floor(subdivision/state.subdivisionMode)%METER_BEATS[state.meter],level=positionInBeat===0?(beatIndex===0?'primary':'beat'):'subdivision';click(level,time);});
  if(state.pulseFrame===null)state.pulseFrame=requestAnimationFrame(drawScheduledPulses);
}
function stopScheduler() {
  state.resumeGeneration+=1;
  state.scheduler?.stop();state.scheduledSources.forEach((_,source)=>{try{source.stop();}catch{}});state.scheduledSources.clear();state.pulseQueue=[];
  if(state.pulseFrame!==null)cancelAnimationFrame(state.pulseFrame);state.pulseFrame=null;
}
function renderMeter() { $$('.meter-option').forEach(button=>{const active=button.dataset.meter===state.meter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});$('#meterTriggerValue').textContent=state.meter; }
function setMeter(value) { if(!METER_BEATS[value])return;state.meter=value;state.subdivision=0;localStorage.setItem('meter',value);renderMeter();if(state.playing)startScheduler();toast(`Battuta: ${value}`); }
function renderDivision() { $$('.division-option').forEach(button=>{const active=Number(button.dataset.subdivision)===state.subdivisionMode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});$('#divisionTriggerValue').textContent={1:'1/4',2:'1/8',3:'×3',4:'1/16'}[state.subdivisionMode]; }
function setDivision(value) { state.subdivisionMode=Number(value);state.subdivision=0;localStorage.setItem('subdivisionMode',state.subdivisionMode);renderDivision();if(state.playing)startScheduler();const labels={1:'Quarti',2:'Ottavi',3:'Terzine',4:'Sedicesimi'};toast(`Suddivisione: ${labels[state.subdivisionMode]}`); }
function setupLongPressSelector(trigger) {
  const selector=$(`#${trigger.dataset.selector}`),options=[...selector.querySelectorAll('button')];let timer=null,opened=false,hovered=null,startX=0,startY=0,suppressClick=false;
  const close=()=>{selector.classList.remove('touch-open');selector.style.removeProperty('left');selector.style.removeProperty('right');selector.style.removeProperty('top');options.forEach(option=>option.classList.remove('touch-hover'));hovered=null;};
  trigger.addEventListener('pointerdown',event=>{if(innerWidth>760)return;startX=event.clientX;startY=event.clientY;opened=false;trigger.setPointerCapture(event.pointerId);timer=setTimeout(()=>{opened=true;suppressClick=true;const active=Math.max(0,options.findIndex(option=>option.classList.contains('active'))),edgeOffset=24,width=Math.min(72,(innerWidth-edgeOffset*2-12)/options.length),touchX=event.clientX,touchY=event.clientY;selector.style.setProperty('--touch-option-width',`${width}px`);selector.style.left=`${edgeOffset}px`;selector.style.top=`${Math.max(edgeOffset,touchY-25)}px`;selector.classList.add('touch-open');hovered=options[active];hovered?.classList.add('touch-hover');requestAnimationFrame(()=>{const rect=selector.getBoundingClientRect(),activeRect=options[active].getBoundingClientRect(),activeCenterOffset=activeRect.left+activeRect.width/2-rect.left,maxLeft=Math.max(edgeOffset,innerWidth-edgeOffset-rect.width),desiredLeft=touchX-activeCenterOffset,top=Math.max(edgeOffset,Math.min(innerHeight-edgeOffset-rect.height,touchY-rect.height/2)),left=Math.max(edgeOffset,Math.min(maxLeft,desiredLeft));selector.style.removeProperty('right');selector.style.left=`${left}px`;selector.style.top=`${top}px`;});navigator.vibrate?.(12);},420);});
  trigger.addEventListener('pointermove',event=>{if(!opened){if(Math.hypot(event.clientX-startX,event.clientY-startY)>12)clearTimeout(timer);return;}const option=document.elementFromPoint(event.clientX,event.clientY)?.closest(`#${selector.id} button`);if(option&&option!==hovered){options.forEach(item=>item.classList.remove('touch-hover'));hovered=option;hovered.classList.add('touch-hover');navigator.vibrate?.(5);}});
  const finish=()=>{clearTimeout(timer);if(opened&&hovered){hovered.dataset.meter?setMeter(hovered.dataset.meter):setDivision(hovered.dataset.subdivision);}close();opened=false;};
  trigger.addEventListener('pointerup',finish);trigger.addEventListener('pointercancel',()=>{clearTimeout(timer);close();opened=false;});trigger.addEventListener('contextmenu',event=>event.preventDefault());trigger.addEventListener('click',event=>{if(innerWidth>760)return;event.preventDefault();if(suppressClick){suppressClick=false;return;}toast('Tieni premuto e trascina');});
}
function togglePlay() {
  state.playing = !state.playing; const button = $('#playButton'); button.classList.toggle('playing', state.playing); button.ariaLabel = state.playing ? 'Pausa metronomo' : 'Avvia metronomo';
  if (state.playing) { state.subdivision=0; state.audio ||= new (window.AudioContext || window.webkitAudioContext)(); resumeScheduler(); }
  else { stopScheduler(); state.subdivision=0; }
}
function failAudio(message,error) { console.error('[BPM audio]',error);state.playing=false;stopScheduler();const button=$('#playButton');button.classList.remove('playing');button.ariaLabel='Avvia metronomo';toast(message); }
async function resumeScheduler() { const generation=++state.resumeGeneration;try{await state.audio.resume();}catch(error){if(generation===state.resumeGeneration&&state.playing)failAudio('Audio non disponibile',error);return;}if(generation!==state.resumeGeneration||!state.playing)return;try{startScheduler();}catch(error){failAudio('Errore avvio audio',error);} }
function useTrack(track) { setBpm(track.bpm,track.id); location.hash='player';showScreen('player');const pad=$(`.compact-track[data-use="${track.id}"]`);if(pad){$$('.compact-track').forEach(item=>item.classList.remove('launched'));requestAnimationFrame(()=>{pad.classList.add('launched');setTimeout(()=>pad.classList.remove('launched'),450);});}toast(`${track.title} · ${track.bpm} BPM`); }
function tapTempo() { const now=performance.now(),last=state.tapTimes.at(-1);if(last&&now-last>2000)state.tapTimes=[];state.tapTimes.push(now);if(state.tapTimes.length>6)state.tapTimes.shift();animatePulse('primary');if(state.tapTimes.length<2)return;const intervals=state.tapTimes.slice(1).map((time,index)=>time-state.tapTimes[index]);const average=intervals.reduce((sum,value)=>sum+value,0)/intervals.length;const bpm=Math.round(60000/average);if(bpm>=20&&bpm<=300)setBpm(bpm); }
function normalizeSearch(value='') { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').trim(); }
function renderVirtualSongs() { const viewport=$('#songCatalogResults');if(viewport.hidden)return;const rowHeight=55,start=Math.max(0,Math.floor(viewport.scrollTop/rowHeight)-1),end=Math.min(state.songMatches.length,start+5),playlist=currentPlaylist(),existing=new Set((playlist?.tracks||[]).map(track=>track.song_id));const windowEl=viewport.querySelector('.virtual-window');if(!windowEl)return;windowEl.innerHTML=state.songMatches.slice(start,end).map((song,index)=>{const added=existing.has(song.id),position=(start+index)*rowHeight;return `<div class="catalog-song" style="transform:translateY(${position}px)"><div><b>${escapeHtml(song.title)}</b><span>${escapeHtml(song.artist)||'Artista non indicato'}</span></div><strong>${song.bpm}</strong><button data-add-song="${song.id}" ${added?'disabled':''}>${added?'IMPORTATO':'＋ IMPORTA'}</button></div>`;}).join(''); }
function renderSongCatalog() { const viewport=$('#songCatalogResults'),query=normalizeSearch(state.songQuery);$('#songLibraryCount').textContent=`${state.songs.length} SALVATI`;if(!query){state.songMatches=[];viewport.hidden=true;viewport.innerHTML='';return;}const terms=query.split(/\s+/);state.songMatches=state.songs.filter(song=>{const text=normalizeSearch(`${song.title} ${song.artist} ${song.bpm}`);return terms.every(term=>text.includes(term));});viewport.hidden=false;viewport.scrollTop=0;if(!state.songMatches.length){viewport.classList.add('no-results');viewport.innerHTML='<div class="catalog-empty">Nessun brano trovato.</div>';return;}viewport.classList.remove('no-results');viewport.innerHTML=`<div class="virtual-spacer" style="height:${state.songMatches.length*55}px"></div><div class="virtual-window"></div>`;renderVirtualSongs(); }

function render() {
  const playlist = currentPlaylist();
  $('#activePlaylistName').textContent = playlist?.name || 'Nessuna playlist'; $('#libraryPlaylistName').textContent = playlist?.name || '—';
  $('#trackCount').textContent = `${playlist?.tracks.length || 0} BRANI`;
  $('#playlistList').innerHTML = state.library.map(p => `<div class="playlist-item ${p.id===state.playlistId?'active':''}"><button class="playlist-select" data-playlist="${p.id}"><b>${escapeHtml(p.name)}</b><span>${p.tracks.length}</span></button><button class="playlist-delete" data-delete-playlist="${p.id}" aria-label="Elimina playlist ${escapeHtml(p.name)}" title="Elimina playlist">${solidIcon.trash}</button></div>`).join('');
  const empty = '<div class="empty">Nessun brano in questa playlist.</div>';
  $('#playerTrackList').innerHTML = playlist?.tracks.length ? playlist.tracks.map(t => `<button class="compact-track ${t.id===state.selectedTrackId?'active':''}" data-use="${t.id}" data-bpm="${t.bpm}" aria-label="Imposta ${escapeHtml(t.title)}, ${t.bpm} BPM"><i aria-hidden="true"></i><b>${escapeHtml(t.title)}</b><span>${t.bpm} BPM</span></button>`).join('') : empty;
  $('#libraryTrackList').innerHTML = playlist?.tracks.length ? playlist.tracks.map((t,i) => `<div class="track-row"><div class="track-main"><span class="track-number">${String(i+1).padStart(2,'0')}</span><b>${escapeHtml(t.title)}</b></div><span class="track-artist">${escapeHtml(t.artist)||'—'}</span><span class="track-bpm">${t.bpm}</span><div class="row-actions"><button class="action-use" data-use="${t.id}" title="Usa BPM" aria-label="Usa BPM di ${escapeHtml(t.title)}">${solidIcon.play}</button><button class="action-edit" data-edit="${t.id}" title="Modifica" aria-label="Modifica ${escapeHtml(t.title)}">${solidIcon.edit}</button><button class="action-delete" data-delete="${t.id}" title="Elimina" aria-label="Elimina ${escapeHtml(t.title)}">${solidIcon.trash}</button></div></div>`).join('') : empty;
  renderSongCatalog();
}
function escapeHtml(s='') { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function findTrack(id) { return currentPlaylist()?.tracks.find(t => t.id === Number(id)); }
function showScreen(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id===id)); $$('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.screen===id)); }
function openTrack(track) { const form=$('#trackForm'); form.reset(); form.elements.id.value=track?.id||''; form.elements.title.value=track?.title||''; form.elements.artist.value=track?.artist||''; form.elements.bpm.value=track?.bpm||state.bpm; $('#trackDialogTitle').textContent=track?'Modifica brano':'Nuovo brano'; $('#trackDialog').showModal(); }
function openPlaylistDialog() { const form=$('#playlistForm'); form.reset(); $('#playlistDialog').showModal(); requestAnimationFrame(()=>form.elements.name.focus()); }
function openDeleteDialog(track) { state.deleteTrackId=track.id; $('#deleteTrackName').textContent=track.title; $('#deleteDialog').showModal(); }
function closeDeleteDialog() { state.deleteTrackId=null; $('#deleteDialog').close(); }
function openDeletePlaylistDialog(playlist) { state.deletePlaylistId=playlist.id; $('#deletePlaylistName').textContent=playlist.name; const count=playlist.tracks.length; $('#deletePlaylistTrackCount').textContent=`${count} ${count===1?'brano':'brani'}`; $('#deletePlaylistDialog').showModal(); }
function closeDeletePlaylistDialog() { state.deletePlaylistId=null; $('#deletePlaylistDialog').close(); }
function connectRealtime() {
  const stream = new EventSource('/api/events');
  stream.addEventListener('library',event=>{
    const update=JSON.parse(event.data);
    if(update.source===state.clientId)return;
    clearTimeout(state.syncTimer);
    state.syncTimer=setTimeout(()=>loadLibrary().then(()=>toast('Libreria aggiornata')).catch(()=>{}),100);
  });
  stream.addEventListener('open',()=>document.querySelector('.status span').textContent='SYNC');
  stream.addEventListener('error',()=>document.querySelector('.status span').textContent='RECONNECT');
}
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function installDismissedRecently() { const dismissed=Number(localStorage.getItem('installDismissedAt')||0); return Date.now()-dismissed < 7*24*60*60*1000; }
function showInstallBanner() { if(isStandalone()||installDismissedRecently()) return; const banner=$('#installBanner'); banner.hidden=false; requestAnimationFrame(()=>banner.classList.add('visible')); }
function hideInstallBanner(remember=false) { const banner=$('#installBanner'); banner.classList.remove('visible'); if(remember)localStorage.setItem('installDismissedAt',Date.now()); setTimeout(()=>banner.hidden=true,450); }

$('#bpmSlider').addEventListener('input', e => setBpm(e.target.value));
$('#bpmInput').addEventListener('change', e => setBpm(e.target.value));
$('#bpmInput').addEventListener('focus', e => e.target.select());
$('#playButton').addEventListener('click', togglePlay);
$('#pulse').addEventListener('click',tapTempo);
$$('.division-option').forEach(button=>button.addEventListener('click',()=>setDivision(button.dataset.subdivision)));
$$('.meter-option').forEach(button=>button.addEventListener('click',()=>setMeter(button.dataset.meter)));
$$('.touch-selector-trigger').forEach(setupLongPressSelector);
$('.rhythm-controls').addEventListener('selectstart',event=>event.preventDefault());
$('.rhythm-controls').addEventListener('dragstart',event=>event.preventDefault());
$$('.step').forEach(b => b.addEventListener('click', () => setBpm(state.bpm + Number(b.dataset.delta))));
$$('.bottom-nav a').forEach(a => a.addEventListener('click', () => showScreen(a.dataset.screen)));
$('#openTracks').addEventListener('click', () => { location.hash='tracks'; showScreen('tracks'); });
$('#newTrackButton').addEventListener('click',()=>openTrack());
$('#newPlaylistButton').addEventListener('click',openPlaylistDialog);
$('#songSearch').addEventListener('input',event=>{state.songQuery=event.target.value;renderSongCatalog();});
$('#songCatalogResults').addEventListener('scroll',renderVirtualSongs,{passive:true});
document.addEventListener('click', async e => {
  const playlist=e.target.closest('[data-playlist]'); if(playlist){state.playlistId=Number(playlist.dataset.playlist);render();return;}
  const deletePlaylist=e.target.closest('[data-delete-playlist]'); if(deletePlaylist){const item=state.library.find(p=>p.id===Number(deletePlaylist.dataset.deletePlaylist));if(item)openDeletePlaylistDialog(item);return;}
  const addSong=e.target.closest('[data-add-song]');if(addSong&&!addSong.disabled){if(!state.playlistId){toast('Crea prima una playlist');return;}addSong.disabled=true;try{await api('/api/playlist-tracks',{method:'POST',body:JSON.stringify({playlist_id:state.playlistId,song_id:Number(addSong.dataset.addSong)})});await loadLibrary();toast('Brano aggiunto alla playlist');}catch(error){addSong.disabled=false;toast(error.message);}return;}
  const use=e.target.closest('[data-use]'); if(use){const t=findTrack(use.dataset.use);if(t)useTrack(t);return;}
  const edit=e.target.closest('[data-edit]'); if(edit){openTrack(findTrack(edit.dataset.edit));return;}
  const del=e.target.closest('[data-delete]'); if(del){const track=findTrack(del.dataset.delete);if(track)openDeleteDialog(track);}
});
$('#trackForm').addEventListener('submit', async e => { e.preventDefault(); const f=new FormData(e.target), id=f.get('id'); const body={title:f.get('title'),artist:f.get('artist'),bpm:Number(f.get('bpm'))}; try{await api(id?`/api/tracks/${id}`:'/api/songs',{method:id?'PUT':'POST',body:JSON.stringify(body)});$('#trackDialog').close();await loadLibrary();toast(id?'Brano aggiornato ovunque':'Brano salvato nella libreria');}catch(err){toast(err.message);} });
$('#playlistForm').addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.target).get('name')?.trim();if(!name)return;try{const playlist=await api('/api/playlists',{method:'POST',body:JSON.stringify({name})});state.playlistId=playlist.id;$('#playlistDialog').close();await loadLibrary();toast('Playlist creata');}catch(error){toast(error.message);}});
$$('#trackDialog .dialog-close,#trackForm .cancel-button').forEach(b=>b.addEventListener('click',()=>$('#trackDialog').close()));
$('#closePlaylistDialog').addEventListener('click',()=>$('#playlistDialog').close());
$('#cancelPlaylist').addEventListener('click',()=>$('#playlistDialog').close());
$('#cancelDelete').addEventListener('click',closeDeleteDialog);
$('#confirmDelete').addEventListener('click',async()=>{if(!state.deleteTrackId)return;const id=state.deleteTrackId;try{await api(`/api/tracks/${id}`,{method:'DELETE'});closeDeleteDialog();await loadLibrary();toast('Brano eliminato');}catch(error){toast(error.message);}});
$('#cancelDeletePlaylist').addEventListener('click',closeDeletePlaylistDialog);
$('#confirmDeletePlaylist').addEventListener('click',async()=>{if(!state.deletePlaylistId)return;const id=state.deletePlaylistId;try{await api(`/api/playlists/${id}`,{method:'DELETE'});closeDeletePlaylistDialog();state.playlistId=null;await loadLibrary();toast('Playlist eliminata');}catch(error){toast(error.message);}});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;showInstallBanner();});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;hideInstallBanner();toast('BPM Studio installata');});
$('#installButton').addEventListener('click',async()=>{
  if(state.installPrompt){state.installPrompt.prompt();const result=await state.installPrompt.userChoice;if(result.outcome==='accepted')hideInstallBanner();state.installPrompt=null;return;}
  if(/iphone|ipad|ipod/i.test(navigator.userAgent)){$('#installMessage').textContent='Tocca Condividi, poi “Aggiungi alla schermata Home”.';toast('Condividi → Aggiungi alla schermata Home');return;}
  toast('Apri il menu del browser e scegli “Installa app”');
});
$('#dismissInstall').addEventListener('click',()=>hideInstallBanner(true));
window.addEventListener('hashchange',()=>showScreen(location.hash==='#tracks'?'tracks':'player'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopScheduler();state.pulseAnimation?.cancel();state.pulseAnimation=null;clearTimeout(state.pulseFallbackTimer);return;}if(state.playing){state.subdivision=0;resumeScheduler();}});
setBpm(state.bpm);renderMeter();renderDivision();showScreen(location.hash==='#tracks'?'tracks':'player');loadLibrary().catch(()=>toast('Server non raggiungibile'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=30', {updateViaCache:'none'});
if(!isStandalone()&&/iphone|ipad|ipod/i.test(navigator.userAgent))setTimeout(showInstallBanner,1200);
connectRealtime();
if(/iphone|ipad|ipod/i.test(navigator.userAgent)){
  ['gesturestart','gesturechange','gestureend'].forEach(type=>document.addEventListener(type,event=>event.preventDefault(),{passive:false}));
}

/* Disposable PWA compatibility harness — synthetic data only. */
let DB = null;
const CFG = window.TEST_CONFIG || { vapidPublicKey: '', senderEndpoint: 'http://localhost:8787' };

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pwa-test', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', {keyPath:'id'});
      if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', {keyPath:'id'});
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb() {
  if (!DB) DB = await openDB();
  return {
    put: (store, val) => new Promise((res,rej)=>{const t=DB.transaction(store,'readwrite');t.objectStore(store).put(val);t.oncomplete=()=>res(val);t.onerror=()=>rej(t.error)}),
    all: (store) => new Promise((res,rej)=>{const t=DB.transaction(store,'readonly');const q=t.objectStore(store).getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}),
  };
}
window.__idb = idb;

const set = (k,v) => document.getElementById('v-'+k).textContent = v;
const newId = p => p+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);

async function addNote(text, kind='text') {
  const item = {id:newId(kind), kind, text, createdAt:new Date().toISOString(), syncState:'pending'};
  await (await idb()).put('items', item);
  await render(); return item;
}
async function record(seconds=10) {
  const st = await navigator.mediaDevices.getUserMedia({audio:true});
  const rec = new MediaRecorder(st);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => rec.onstop = r);
  rec.start();
  await new Promise(r => setTimeout(r, seconds*1000));
  rec.stop(); await done; st.getTracks().forEach(t=>t.stop());
  const blob = new Blob(chunks, {type: rec.mimeType || 'audio/webm'});
  const item = {id:newId('audio'), kind:'audio', mime:blob.type, size:blob.size, blob,
                text:'synthetic audio memo', createdAt:new Date().toISOString(), syncState:'pending'};
  await (await idb()).put('items', item);
  await render(); return {id:item.id, size:item.size, mime:item.mime};
}
async function subscribe() {
  if (!('PushManager' in window)) return {error:'no PushManager'};
  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return {error:'permission:'+perm};
  const sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: b64urlToBuf(CFG.vapidPublicKey)});
  const json = sub.toJSON();
  await (await idb()).put('items', {id:newId('sub'), kind:'subscription', text:JSON.stringify(json), createdAt:new Date().toISOString(), syncState:'local'});
  document.getElementById('subjson').textContent = JSON.stringify(json);
  // best-effort delivery to the local sender (phone reaches desktop via adb reverse)
  try { await fetch(CFG.senderEndpoint+'/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(json)}); }
  catch(e) { /* blocked or unreachable — use the JSON above instead */ }
  await render(); return {ok:true, endpoint:(json.endpoint||'').slice(-24)};
}
async function syncPending() {
  const items = (await (await idb()).all('items')).filter(i => i.syncState === 'pending');
  const results = [];
  for (const i of items) {
    try {
      const r = await fetch(CFG.senderEndpoint+'/note',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({id:i.id,kind:i.kind,text:i.text,createdAt:i.createdAt})});
      if (r.ok) { i.syncState='synced'; await (await idb()).put('items', i); results.push({id:i.id,ok:true}); }
      else results.push({id:i.id,ok:false,status:r.status});
    } catch(e) { results.push({id:i.id,ok:false,error:String(e)}); }
  }
  await render(); return results;
}
async function render() {
  const items = (await (await idb()).all('items')).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  document.getElementById('items').innerHTML = items.map(i =>
    `<li><span class="tag">${i.kind}</span><span class="tag">${i.syncState||'?'}</span>${escapeHtml(String(i.text||'').slice(0,120))}</li>`).join('');
  const evs = await (await idb()).all('events');
  document.getElementById('events').innerHTML = evs.map(e =>
    `<li><span class="tag">${e.type}</span>${escapeHtml(JSON.stringify(e.payload||{}))} <small>${e.at||''}</small></li>`).join('');
  return true;
}
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({'&':'&','<':'<','>':'>','"':'"'}[c]));}
function b64urlToBuf(b64){const p=b64.split('=')[0];const bin=atob(p.replace(/-/g,'+').replace(/_/g,'/'));const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}

document.getElementById('b-note').onclick = () => addNote('synthetic test note ' + new Date().toISOString());
document.getElementById('b-rec').onclick  = () => record(10).catch(e => alert('record failed: '+e));
document.getElementById('b-sub').onclick = () => subscribe().catch(e => alert('subscribe failed: '+e));
document.getElementById('b-sync').onclick= () => syncPending().catch(e => alert('sync failed: '+e));
document.getElementById('b-dump').onclick= async () => {
  const d = await window.__test.dump();
  document.getElementById('subjson').textContent = JSON.stringify(d,null,2);
};

window.__test = {
  addNote, record, subscribe, syncPending, render,
  dump: async () => ({
    items: await (await idb()).all('items'),
    events: await (await idb()).all('events'),
    secureContext: window.isSecureContext,
    sw: !!(await navigator.serviceWorker.getRegistration()),
    mediaRecorder: typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported('audio/webm') : false,
    pushManager: 'PushManager' in window,
    permission: Notification.permission,
  })
};

(async () => {
  set('sec', String(window.isSecureContext));
  set('idb','opening…');
  try { await idb(); set('idb','ok'); } catch(e){ set('idb','error: '+e); }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', {scope:'./'});
    set('sw', reg.active ? 'active' : 'registered');
  } catch(e) { set('sw','error: '+e); }
  set('push', 'PushManager' in window ? 'available' : 'unavailable');
  await render();
})();

(async () => {
  const q = new URLSearchParams(location.search);
  const payload = {title:q.get('title')||'', text:q.get('text')||'', url:q.get('url')||''};
  document.getElementById('out').textContent = JSON.stringify(payload,null,2);
  try {
    const idb = await window.__idb();
    await idb.put('items', {id:'share-'+Date.now(), kind:'shared', text:JSON.stringify(payload),
      createdAt:new Date().toISOString(), syncState:'pending'});
  } catch(e) { document.getElementById('out').textContent += '\n\nsave error: '+e; }
})();

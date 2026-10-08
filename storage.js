import { cleanSettings, MAX_BACKUP_BYTES } from './model.js';
let db;
export function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cuemix-v1', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('sounds', { keyPath: 'id' }); req.result.createObjectStore('settings'); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('別のタブのCueMixを閉じて、再読み込みしてください。'));
    req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); resolve(); };
  });
}
function transact(mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sounds', 'settings'], mode);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('保存を完了できませんでした。')); tx.onerror = () => {};
    try { work(tx.objectStore('sounds'), tx.objectStore('settings'), tx); } catch (e) { tx.abort(); reject(e); }
  });
}
export async function readAll() {
  let sounds, settings;
  await transact('readonly', (a, b) => { const ar = a.getAll(); const br = b.get('main'); ar.onsuccess = () => { sounds = ar.result; }; br.onsuccess = () => { settings = br.result; }; });
  return { records: sounds || [], settings: cleanSettings(settings) };
}
export function putSound(record) {
  // Enforce a total ceiling inside the write transaction, including other tabs' changes.
  return transact('readwrite', (sounds, settings, tx) => {
    const req = sounds.getAll();
    req.onsuccess = () => {
      const total = req.result.filter(x => x.id !== record.id).reduce((sum, x) => sum + x.blob.size, 0) + record.blob.size;
      if (total > MAX_BACKUP_BYTES - 1024 * 1024) { tx.abort(); return; }
      sounds.put(record);
    };
  });
}
export const deleteSound = id => transact('readwrite', sounds => sounds.delete(id));
export const putSettings = settings => transact('readwrite', (a, b) => b.put(cleanSettings(settings), 'main'));
export const replaceAll = (records, settings) => transact('readwrite', (a, b) => { a.clear(); for (const record of records) a.put(record); b.put(cleanSettings(settings), 'main'); });

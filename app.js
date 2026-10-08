import { TYPES, DEFAULT_SETTINGS, MAX_AUDIO_BYTES, cleanSettings, timeLabel, validRecord, buildBackup, parseBackup } from './model.js';
import * as store from './storage.js';
import { AudioDesk, inspectAudio } from './audio.js';

const $ = selector => document.querySelector(selector);
const records = new Map();
const settings = { ...DEFAULT_SETTINGS };
const selected = { song: null, bgm: 'bgm-0' };
const labels = { fx: 'ジングル', song: '歌枠', bgm: 'BGM' };
const keys = ['1','2','3','4','5','Q','W','E','R','T','A','S','D','F','G'];
const codes = ['Digit1','Digit2','Digit3','Digit4','Digit5','KeyQ','KeyW','KeyE','KeyR','KeyT','KeyA','KeyS','KeyD','KeyF','KeyG'];
let ready = false, busy = false, editId = null, pendingFile = null, toastTimer, saveTimer, settingsWrite = Promise.resolve();
const desk = new AudioDesk({ records, settings, onChange: updatePlayback, onError: message });
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cuemix-changes') : null;
function message(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500); }
function tellOtherTabs() { channel?.postMessage('changed'); }
function button(text, className, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (className) b.className = className; if (action) b.addEventListener('click', action); return b; }
function span(text, className) { const s = document.createElement('span'); s.textContent = text; if (className) s.className = className; return s; }
function idName(id) { const [type, n] = id.split('-'); return `${labels[type]} ${String(Number(n) + 1).padStart(2, '0')}`; }
function storageError(error) { return error?.name === 'QuotaExceededError' ? '保存容量が足りません。使わない音源を解除するか、ファイルを小さくして試してください。' : (error?.message || '保存できませんでした。ブラウザの保存設定・容量を確認してください。'); }
function lock(value) { busy = value; $('#workspace').setAttribute('aria-busy', String(value)); for (const element of document.querySelectorAll('#edit-form button, #edit-form input, #export-backup, #import-backup')) element.disabled = value || !ready; }

function renderSlots() {
  const focus = document.activeElement?.dataset?.focus;
  const grid = $('#effects-grid'); grid.replaceChildren();
  for (let i = 0; i < TYPES.fx; i++) {
    const id = `fx-${i}`, sound = records.get(id), cell = document.createElement('div'); cell.className = 'effect-cell';
    const pad = button('', `pad${sound ? ' filled' : ''}`, () => { if (!ready || busy) return; if (records.has(id)) void desk.effect(id); else openEditor(id); });
    pad.id = `pad-${i}`; pad.dataset.focus = `pad-${i}`; pad.disabled = !ready; pad.setAttribute('aria-label', sound ? `${sound.name}を再生（${keys[i]}）` : `${idName(id)}に音源を登録`);
    const top = span('', 'pad-top'); top.append(span(String(i + 1).padStart(2, '0'), 'slot-number')); const kbd = document.createElement('kbd'); kbd.textContent = keys[i]; top.append(kbd);
    pad.append(top, span(sound?.name || '＋ 音を登録', 'pad-name'), span(sound ? timeLabel(sound.duration) : '未登録', 'pad-meta')); if (sound) pad.title = sound.name;
    cell.append(pad);
    if (sound) { const edit = button('編集', 'slot-edit', () => openEditor(id)); edit.setAttribute('aria-label', `${sound.name}を編集`); edit.dataset.focus = `edit-${id}`; cell.append(edit); }
    grid.append(cell);
  }
  const list = $('#songs-list'); list.replaceChildren();
  for (let i = 0; i < TYPES.song; i++) {
    const id = `song-${i}`, sound = records.get(id), row = document.createElement('div'); row.className = 'song-row';
    row.append(span(String(i + 1).padStart(2, '0'), 'slot-number'));
    const pick = button(sound?.name || '＋ 曲を登録', 'song-select', () => { if (!ready || busy) return; if (records.has(id)) { selected.song = id; updatePlayback(); } else openEditor(id); });
    pick.dataset.id = id; pick.dataset.focus = `pick-${id}`; pick.disabled = !ready; pick.setAttribute('aria-pressed', String(selected.song === id)); if (sound) pick.title = sound.name; row.append(pick);
    if (sound) { const edit = button('編集', 'edit-inline', () => openEditor(id)); edit.setAttribute('aria-label', `${sound.name}を編集`); edit.dataset.focus = `edit-${id}`; row.append(edit); }
    list.append(row);
  }
  const bgms = $('#bgm-slots'); bgms.replaceChildren();
  for (let i = 0; i < TYPES.bgm; i++) {
    const id = `bgm-${i}`, sound = records.get(id), card = document.createElement('div'); card.className = 'bgm-card';
    const pick = button('', 'bgm-pick', () => { if (!ready || busy) return; selected.bgm = id; updatePlayback(); if (!records.has(id)) openEditor(id); });
    pick.dataset.id = id; pick.dataset.focus = `pick-${id}`; pick.disabled = !ready; pick.setAttribute('aria-pressed', String(selected.bgm === id));
    const top = span('', 'bgm-top'); top.append(span(`BGM 0${i + 1}`), span('', 'bgm-badge')); pick.append(top, span(sound?.name || '＋ 音を登録', 'bgm-name')); if (sound) pick.title = sound.name; card.append(pick);
    if (sound) { const edit = button('編集', 'slot-edit', () => openEditor(id)); edit.setAttribute('aria-label', `${sound.name}を編集`); edit.dataset.focus = `edit-${id}`; card.append(edit); }
    bgms.append(card);
  }
  for (const [type, selector] of [['fx', '#effect-count'], ['song', '#song-count'], ['bgm', '#bgm-count']]) $(selector).textContent = `${[...records.keys()].filter(id => id.startsWith(type + '-')).length} / ${TYPES[type]}`;
  const bytes = [...records.values()].reduce((total, r) => total + r.blob.size, 0);
  $('#storage-status').textContent = ready ? `この端末に保存 · ${records.size}音 / ${(bytes / 1024 / 1024).toFixed(1)} MB` : '保存機能を利用できません';
  updatePlayback();
  if (focus) [...document.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === focus)?.focus();
}
function updatePlayback() {
  for (let i = 0; i < TYPES.fx; i++) $(`#pad-${i}`)?.classList.toggle('playing', [...desk.effects].some(e => e.id === `fx-${i}` && !e.audio.paused));
  for (const type of ['song', 'bgm']) {
    const entry = desk.channels[type], sound = records.get(selected[type]), active = !!entry && !entry.audio.paused && !entry.audio.ended;
    const play = $(`#${type}-play`); play.disabled = !ready || busy || !sound;
    play.textContent = entry?.id === selected[type] && active ? '▶ 再生中' : entry?.id === selected[type] && !entry.audio.ended ? '▶ 再開' : entry && entry.id !== selected[type] ? '▶ 選択曲に切替' : '▶ 再生';
    if (active && entry?.id === selected[type]) play.disabled = true;
    $(`#${type}-pause`).disabled = !active || busy; $(`#${type}-stop`).disabled = !entry || busy;
    $(`#${type}-state`).textContent = active ? '再生中' : entry && !entry.audio.ended ? '一時停止' : '停止中';
    $(`#${type}-state`).classList.toggle('active', active);
    for (const pick of document.querySelectorAll(type === 'song' ? '.song-select' : '.bgm-pick')) {
      pick.setAttribute('aria-pressed', String(pick.dataset.id === selected[type]));
      if (type === 'bgm') pick.querySelector('.bgm-badge').textContent = pick.dataset.id === entry?.id ? (active ? '再生中' : '停止中') : pick.dataset.id === selected[type] ? '選択中' : '';
    }
  }
  const song = desk.channels.song;
  $('#song-current').textContent = (song ? records.get(song.id)?.name : records.get(selected.song)?.name) || '曲を登録してください';
  $('#song-current').title = $('#song-current').textContent;
  $('#song-start').disabled = !song || busy; $('#song-seek').disabled = !song || !Number.isFinite(song.audio.duration) || busy;
  const bgm = desk.channels.bgm; $('#bgm-current').textContent = bgm ? `再生対象：${records.get(bgm.id)?.name || ''}` : '';
  updateTime();
}
function updateTime() {
  const audio = desk.channels.song?.audio;
  const duration = Number.isFinite(audio?.duration) ? audio.duration : records.get(selected.song)?.duration || 0;
  const current = audio?.currentTime || 0;
  if (document.activeElement !== $('#song-seek')) $('#song-seek').value = String(duration ? current / duration * 1000 : 0);
  $('#song-elapsed').textContent = timeLabel(current); $('#song-remaining').textContent = duration ? `残り ${timeLabel(Math.max(0, duration - current))}` : '残り −:−';
}
setInterval(updateTime, 250);

function openEditor(id) {
  if (!ready || busy) return; editId = id; pendingFile = null; const sound = records.get(id);
  $('#edit-title').textContent = `${idName(id)} · ${sound ? '編集' : '音源を登録'}`;
  $('#audio-file').value = ''; $('#sound-name').value = sound?.name || ''; $('#sound-volume').value = String(sound?.volume ?? 100); $('#sound-volume').nextElementSibling.textContent = `${sound?.volume ?? 100}%`;
  $('#file-label').textContent = sound ? '音源を差し替える' : '音声ファイルを選ぶ'; $('#file-details').textContent = sound ? `登録済み：${sound.name} · ${timeLabel(sound.duration)}` : 'MP3・WAV・M4Aなど · 1音80MBまで';
  $('#edit-note').textContent = id.startsWith('fx-') ? 'ジングルは3分以内。名前・音量だけでも変更できます。' : '表示名は自由に変更できます。名前・音量だけの変更も可能です。';
  $('#edit-error').hidden = true; $('#delete-sound').hidden = !sound; $('#edit-dialog').showModal();
}
$('#audio-file').addEventListener('change', event => {
  pendingFile = event.target.files[0] || null; if (!pendingFile) return;
  $('#file-label').textContent = pendingFile.name; $('#file-details').textContent = `${(pendingFile.size / 1024 / 1024).toFixed(1)} MB · 保存時に音源を確認します`;
  if (!$('#sound-name').value.trim()) $('#sound-name').value = pendingFile.name.replace(/\.[^.]+$/, '').slice(0, 60);
});
  $('#sound-volume').addEventListener('input', e => { e.target.nextElementSibling.textContent = `${e.target.value}%`; e.target.nextElementSibling.classList.toggle('boosted', Number(e.target.value) > 100); });
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !ready) return; $('#edit-error').hidden = true;
  const name = $('#sound-name').value.trim(); const old = records.get(editId), file = pendingFile; const id = editId;
  if (!name || (!old && !file)) { $('#edit-error').textContent = '音声ファイルと表示名を指定してください。'; $('#edit-error').hidden = false; return; }
  lock(true);
  try {
    let duration = old?.duration, blob = old?.blob;
    if (file) {
      if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error('音声ファイルは1音80MB以内で選んでください。');
      const total = [...records.values()].filter(r => r.id !== id).reduce((n, r) => n + r.blob.size, 0) + file.size;
      if (total > 499 * 1024 * 1024) throw new Error('登録できる音源の合計は499MBまでです。使わない音源を減らしてください。');
      duration = await inspectAudio(file); if (id.startsWith('fx-') && duration > 180) throw new Error('ジングルには3分以内の音源を登録してください。'); blob = new Blob([file], { type: file.type });
    }
    const record = { id, name, duration, blob, volume: Number($('#sound-volume').value) };
    await store.putSound(record); if (file) desk.stopId(id); records.set(id, record); desk.updateVolumes();
    if (id.startsWith('song-') && !selected.song) selected.song = id;
    $('#edit-dialog').close(); tellOtherTabs(); message(`${name}を保存しました`);
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
  } catch (error) { $('#edit-error').textContent = storageError(error); $('#edit-error').hidden = false; }
  finally { lock(false); renderSlots(); }
});
$('#delete-sound').addEventListener('click', async () => {
  if (busy || !confirm('この枠の登録を解除します。元の音声ファイルは削除されません。')) return;
  lock(true);
  try { await store.deleteSound(editId); desk.stopId(editId); records.delete(editId); $('#edit-dialog').close(); tellOtherTabs(); message('登録を解除しました'); }
  catch (error) { $('#edit-error').textContent = storageError(error); $('#edit-error').hidden = false; }
  finally { lock(false); renderSlots(); }
});
for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => document.getElementById(b.dataset.open).showModal());
document.addEventListener('click', event => { if (event.target.closest('[data-close]') && !busy) event.target.closest('dialog').close(); });
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#stop-all').addEventListener('click', () => { desk.stopAll(); message('すべての音を停止しました'); });
$('#stop-effects').addEventListener('click', () => desk.stopEffects());
for (const type of ['song', 'bgm']) {
  $(`#${type}-play`).addEventListener('click', () => { if (!busy && selected[type]) void desk.play(type, selected[type]); });
  $(`#${type}-pause`).addEventListener('click', () => desk.pause(type));
  $(`#${type}-stop`).addEventListener('click', () => type === 'bgm' ? void desk.stopBgm(true) : desk.stop(type));
}
$('#song-start').addEventListener('click', () => { if (desk.channels.song) desk.channels.song.audio.currentTime = 0; updateTime(); });
$('#song-seek').addEventListener('input', event => { const audio = desk.channels.song?.audio; if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; updateTime(); });

function settingsUI() {
  for (const type of ['fx', 'song', 'bgm']) { $(`#${type}-volume`).value = String(settings[`${type}Volume`]); $(`#${type}-volume`).nextElementSibling.textContent = `${settings[`${type}Volume`]}%`; }
  $('#shortcuts').checked = settings.shortcuts; $('#bgm-loop').checked = settings.loop; $('#auto-duck').checked = settings.autoDuck;
}
function flushSettings() {
  clearTimeout(saveTimer); const snapshot = { ...settings };
  settingsWrite = settingsWrite.then(() => store.putSettings(snapshot)).then(tellOtherTabs).catch(() => message('設定を保存できませんでした。音量などの設定は再読込すると戻る場合があります。'));
  return settingsWrite;
}
function scheduleSettings() { clearTimeout(saveTimer); if (ready) saveTimer = setTimeout(flushSettings, 180); }
for (const type of ['fx', 'song', 'bgm']) $(`#${type}-volume`).addEventListener('input', event => { settings[`${type}Volume`] = Number(event.target.value); event.target.nextElementSibling.textContent = `${event.target.value}%`; desk.updateVolumes(); scheduleSettings(); });
$('#shortcuts').addEventListener('change', e => { settings.shortcuts = e.target.checked; scheduleSettings(); });
$('#bgm-loop').addEventListener('change', e => { desk.setLoop(e.target.checked); scheduleSettings(); });
$('#auto-duck').addEventListener('change', e => { settings.autoDuck = e.target.checked; scheduleSettings(); });
document.addEventListener('keydown', event => {
  if (!ready || busy || !settings.shortcuts || event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable=true]')) return;
  if (event.code === 'Space') { if (event.target.closest('button,a')) return; event.preventDefault(); desk.stopAll(); return; }
  const index = codes.indexOf(event.code); if (index >= 0 && records.has(`fx-${index}`)) { event.preventDefault(); void desk.effect(`fx-${index}`); }
});

$('#export-backup').addEventListener('click', async () => {
  if (!ready || busy) return; lock(true); $('#backup-status').textContent = '書き出しています…';
  try {
    await flushSettings(); const snapshot = await store.readAll(); const blob = buildBackup(snapshot.records, snapshot.settings);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `CueMix-${new Date().toISOString().slice(0, 10)}.cuemix`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $('#backup-status').textContent = `${snapshot.records.length}音と設定を書き出しました。ダウンロード先をご確認ください。`;
  } catch (error) { $('#backup-status').textContent = storageError(error); }
  finally { lock(false); updatePlayback(); }
});
$('#import-backup').addEventListener('click', () => { if (!busy && ready) $('#backup-file').click(); });
$('#backup-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || busy || !ready) return;
  lock(true); $('#backup-status').textContent = 'バックアップを確認しています…';
  try {
    const backup = await parseBackup(file);
    for (let i = 0; i < backup.records.length; i++) {
      $('#backup-status').textContent = `音源を確認しています… ${i + 1} / ${backup.records.length}`;
      const record = backup.records[i]; record.duration = await inspectAudio(record.blob); if (!validRecord(record)) throw new Error('バックアップに使用できない音源が含まれています。');
    }
    if (!confirm(`${backup.records.length}音と設定を読み込み、現在の${records.size}音を置き換えます。続けますか？`)) { $('#backup-status').textContent = '読み込みをキャンセルしました。'; return; }
    await flushSettings(); await store.replaceAll(backup.records, backup.settings); desk.stopAll();
    records.clear(); for (const record of backup.records) records.set(record.id, record); Object.assign(settings, backup.settings); selected.song = backup.records.find(r => r.id.startsWith('song-'))?.id || null;
    settingsUI(); tellOtherTabs(); $('#backup-status').textContent = `${records.size}音と設定を復元しました。`;
  } catch (error) { $('#backup-status').textContent = `読み込めませんでした：${storageError(error)} 現在の登録は変更していません。`; }
  finally { lock(false); renderSlots(); }
});
let changedElsewhere = false;
if (channel) channel.onmessage = () => { changedElsewhere = true; if (!busy) void refreshFromStore(); };
async function refreshFromStore() {
  if (!ready || busy || !changedElsewhere) return; changedElsewhere = false;
  try { const data = await store.readAll(); desk.stopAll(); records.clear(); for (const record of data.records) records.set(record.id, record); Object.assign(settings, data.settings); settingsUI(); renderSlots(); if ($('#edit-dialog').open) $('#edit-dialog').close(); message('別のタブで変更された設定を反映しました'); } catch { message('別のタブの変更を取得できませんでした。再読込してください。'); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshFromStore(); });
window.addEventListener('pagehide', () => desk.stopAll());
async function init() {
  renderSlots();
  try { await store.openStore(); const data = await store.readAll(); for (const record of data.records) if (validRecord(record) && record.blob instanceof Blob) records.set(record.id, record); Object.assign(settings, data.settings); ready = true; selected.song = [...records.keys()].find(id => id.startsWith('song-')) || null; }
  catch (error) { $('#storage-error').textContent = `音源の保存機能を利用できません。通常のブラウザで開き直してください。${error?.message || ''}`; $('#storage-error').hidden = false; }
  settingsUI(); lock(false); renderSlots(); $('#workspace').setAttribute('aria-busy', 'false');
}
void init();

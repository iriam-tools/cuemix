export const TYPES = { fx: 15, song: 5, bgm: 3 };
export const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
export const DEFAULT_SETTINGS = { fxVolume: 80, songVolume: 80, bgmVolume: 30, loop: true, autoDuck: true, shortcuts: true };
export const SLOT_IDS = Object.entries(TYPES).flatMap(([type, count]) => Array.from({ length: count }, (_, i) => `${type}-${i}`));
export const clamp = (value, low = 0, high = 200) => Math.min(high, Math.max(low, value));
export function cleanSettings(value = {}) {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of ['fxVolume', 'songVolume', 'bgmVolume']) if (Number.isFinite(value[key])) result[key] = clamp(value[key]);
  for (const key of ['loop', 'autoDuck', 'shortcuts']) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
export function timeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
export function validRecord(record) {
  return record && SLOT_IDS.includes(record.id) && typeof record.name === 'string' && record.name.trim().length > 0 && record.name.length <= 60 && Number.isFinite(record.volume) && record.volume >= 0 && record.volume <= 200 && Number.isFinite(record.duration) && record.duration > 0 && (record.id.startsWith('fx-') ? record.duration <= 180 : true);
}
const magic = new TextEncoder().encode('CUEMIX01');
export function buildBackup(records, settings) {
  const items = [...records].sort((a, b) => SLOT_IDS.indexOf(a.id) - SLOT_IDS.indexOf(b.id));
  const metadata = { version: 1, settings: cleanSettings(settings), sounds: items.map(({ id, name, volume, duration, blob }) => ({ id, name, volume, duration, size: blob.size, mime: blob.type })) };
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, json.byteLength, true);
  const output = new Blob([magic, length, json, ...items.map(x => x.blob)], { type: 'application/octet-stream' });
  if (output.size > MAX_BACKUP_BYTES) throw new Error('バックアップが500MBを超えます。使わない音源を減らしてから書き出してください。');
  return output;
}
export async function parseBackup(file) {
  if (file.size < 14 || file.size > MAX_BACKUP_BYTES) throw new Error('バックアップの容量が不正です（最大500MB）。');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!magic.every((v, i) => head[i] === v)) throw new Error('CueMixのバックアップファイルではありません。');
  const jsonSize = new DataView(head.buffer).getUint32(8, true);
  if (jsonSize < 2 || jsonSize > 1024 * 1024 || 12 + jsonSize > file.size) throw new Error('バックアップの見出しが壊れています。');
  let data;
  try { data = JSON.parse(await file.slice(12, 12 + jsonSize).text()); } catch { throw new Error('バックアップの設定を読み取れません。'); }
  if (data.version !== 1 || !Array.isArray(data.sounds) || data.sounds.length > SLOT_IDS.length || !data.settings || typeof data.settings !== 'object') throw new Error('対応していないバックアップ形式です。');
  const seen = new Set(); const records = []; let offset = 12 + jsonSize;
  for (const item of data.sounds) {
    if (!validRecord(item) || seen.has(item.id) || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_AUDIO_BYTES || typeof item.mime !== 'string' || item.mime.length > 120 || offset + item.size > file.size) throw new Error('バックアップ内の音源情報が不正です。現在の登録は変更していません。');
    seen.add(item.id);
    records.push({ id: item.id, name: item.name.trim(), volume: item.volume, duration: item.duration, blob: file.slice(offset, offset + item.size, item.mime) });
    offset += item.size;
  }
  if (offset !== file.size) throw new Error('バックアップのファイル長が一致しません。');
  return { records, settings: cleanSettings(data.settings) };
}

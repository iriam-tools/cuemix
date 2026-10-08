import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, cleanSettings, DEFAULT_SETTINGS, SLOT_IDS, timeLabel } from '../model.js';
const record = { id: 'fx-0', name: 'テスト用', volume: 73, duration: 1.5, blob: new Blob([new Uint8Array([0, 1, 2, 254, 255])], { type: 'audio/wav' }) };
test('23枠：ジングル15・歌5・BGM3', () => { assert.equal(SLOT_IDS.length, 23); assert.ok(SLOT_IDS.includes('fx-14')); assert.ok(!SLOT_IDS.includes('song-5')); });
test('音源バイト・日本語名・設定をバックアップから復元', async () => {
  const restored = await parseBackup(buildBackup([record], { ...DEFAULT_SETTINGS, loop: false, bgmVolume: 12 }));
  assert.equal(restored.records[0].name, record.name); assert.equal(restored.records[0].volume, 73);
  assert.deepEqual(new Uint8Array(await restored.records[0].blob.arrayBuffer()), new Uint8Array(await record.blob.arrayBuffer()));
  assert.equal(restored.settings.loop, false); assert.equal(restored.settings.bgmVolume, 12);
});
test('空のバックアップも復元できる', async () => { assert.deepEqual((await parseBackup(buildBackup([], DEFAULT_SETTINGS))).records, []); });
test('個別200%・項目200%の設定を復元', async () => { const restored = await parseBackup(buildBackup([{ ...record, volume: 200 }], { ...DEFAULT_SETTINGS, fxVolume: 200 })); assert.equal(restored.records[0].volume, 200); assert.equal(restored.settings.fxVolume, 200); });
test('壊れた形式・途中で切れたデータを拒否', async () => {
  await assert.rejects(parseBackup(new Blob(['not a backup at all'])));
  const backup = buildBackup([record], DEFAULT_SETTINGS);
  await assert.rejects(parseBackup(backup.slice(0, backup.size - 1)));
  await assert.rejects(parseBackup(new Blob([backup, 'extra'])));
});
test('重複枠・存在しない枠・不正音量を拒否', async () => {
  await assert.rejects(parseBackup(buildBackup([record, record], DEFAULT_SETTINGS)));
  await assert.rejects(parseBackup(buildBackup([{ ...record, id: 'fx-99' }], DEFAULT_SETTINGS)));
  await assert.rejects(parseBackup(buildBackup([{ ...record, volume: -1 }], DEFAULT_SETTINGS)));
});
test('設定は許可したキーのみ、音量は範囲内', () => { assert.deepEqual(cleanSettings({ ...DEFAULT_SETTINGS, bgmVolume: 999, extra: true }), { ...DEFAULT_SETTINGS, bgmVolume: 200 }); });
test('時間表示は長尺・不正値を処理', () => { assert.equal(timeLabel(3661), '61:01'); assert.equal(timeLabel(NaN), '0:00'); });

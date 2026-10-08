import { clamp } from './model.js';
export function inspectAudio(blob) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(); const url = URL.createObjectURL(blob);
    const timer = setTimeout(() => finish(new Error('音源の確認に時間がかかっています。MP3・WAVなどに変換して試してください。')), 15000);
    const finish = (error) => {
      clearTimeout(timer); const duration = audio.duration; audio.onloadedmetadata = null; audio.onerror = null;
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? null : new Error('再生時間を確認できない音源です。MP3・WAVなどで登録してください。'));
    audio.onerror = () => finish(new Error('このブラウザでは再生できない音源です。MP3・WAVなどで試してください。'));
    audio.src = url;
  });
}
export class AudioDesk {
  constructor({ records, settings, onChange, onError }) {
    this.records = records; this.settings = settings; this.onChange = onChange; this.onError = onError;
    this.effects = new Set(); this.pending = new Set(); this.channels = { song: null, bgm: null }; this.token = { song: 0, bgm: 0 }; this.context = null;
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = .003; this.limiter.release.value = .1;
      this.limiter.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }
  make(record, type) {
    const url = URL.createObjectURL(record.blob); const audio = new Audio(url); audio.preload = 'auto';
    const source = this.context.createMediaElementSource(audio); const gainNode = this.context.createGain();
    source.connect(gainNode); gainNode.connect(this.limiter);
    const entry = { id: record.id, audio, url, type, source, gainNode, gain: 1, timer: null, finishFade: null, disposed: false };
    audio.loop = type === 'bgm' && this.settings.loop; this.volume(entry);
    audio.onended = () => { if (type === 'fx') this.release(entry); this.onChange(); };
    audio.onerror = () => { if (!entry.disposed) { this.onError('音源を再生できませんでした。ファイルを差し替えてください。'); this.release(entry); this.onChange(); } };
    for (const ev of ['play', 'pause', 'loadedmetadata', 'durationchange']) audio.addEventListener(ev, () => this.onChange());
    return entry;
  }
  volume(entry) {
    const record = this.records.get(entry.id); const group = this.settings[`${entry.type}Volume`];
    entry.gainNode.gain.setValueAtTime(clamp((record?.volume ?? 100) / 100 * group / 100 * entry.gain, 0, 4), this.context.currentTime);
  }
  updateVolumes() { for (const entry of [...this.effects, ...this.pending, ...Object.values(this.channels).filter(Boolean)]) this.volume(entry); }
  release(entry) {
    if (!entry || entry.disposed) return;
    entry.disposed = true; if (entry.timer) clearInterval(entry.timer); entry.finishFade?.();
    entry.audio.onended = null; entry.audio.onerror = null; entry.audio.pause(); entry.audio.removeAttribute('src'); entry.audio.load(); URL.revokeObjectURL(entry.url);
    entry.source.disconnect(); entry.gainNode.disconnect(); this.pending.delete(entry);
    this.effects.delete(entry); if (this.channels[entry.type] === entry) this.channels[entry.type] = null;
  }
  async effect(id) {
    const record = this.records.get(id); if (!record) return;
    const token = this.effectToken || 0;
    try { await this.unlock(); } catch { this.onError('音声出力を開始できません。ブラウザを再読込してください。'); return; }
    if (token !== (this.effectToken || 0) || this.records.get(id) !== record) return;
    if (this.effects.size >= 12) this.release(this.effects.values().next().value);
    const entry = this.make(record, 'fx'); this.effects.add(entry);
    try { await entry.audio.play(); } catch { if (!entry.disposed) { this.release(entry); this.onError('再生を開始できませんでした。もう一度パッドを押してください。'); } }
    this.onChange();
  }
  fade(entry, ms = 400) {
    if (!entry || entry.disposed || entry.audio.paused) return Promise.resolve();
    if (entry.timer) clearInterval(entry.timer); entry.finishFade?.();
    return new Promise(resolve => {
      const start = performance.now(); const initial = entry.gain; entry.finishFade = resolve;
      entry.timer = setInterval(() => {
        entry.gain = initial * Math.max(0, 1 - (performance.now() - start) / ms); this.volume(entry);
        if (entry.gain <= 0) { clearInterval(entry.timer); entry.timer = null; entry.finishFade = null; resolve(); }
      }, 20);
    });
  }
  async play(type, id) {
    const record = this.records.get(id); if (!record) return false;
    const token = ++this.token[type]; const current = this.channels[type];
    for (const item of [...this.pending]) if (item.type === type) this.release(item);
    try { await this.unlock(); } catch { this.onError('音声出力を開始できません。ブラウザを再読込してください。'); return false; }
    if (token !== this.token[type] || this.records.get(id) !== record) return false;
    if (current?.id === id && !current.disposed) {
      if (current.timer) { clearInterval(current.timer); current.timer = null; current.finishFade?.(); current.finishFade = null; }
      current.gain = 1; this.volume(current);
      try { await current.audio.play(); if (token === this.token[type] && type === 'song' && this.settings.autoDuck) void this.stopBgm(true); } catch { if (!current.disposed) this.onError('再生を開始できませんでした。もう一度再生してください。'); }
      this.onChange(); return true;
    }
    // Start muted within the user gesture so the next track can play after the fade.
    const entry = this.make(record, type); this.pending.add(entry); entry.gain = 0; this.volume(entry);
    try { await entry.audio.play(); } catch { const intentional = entry.disposed; this.release(entry); if (!intentional) this.onError('再生を開始できませんでした。もう一度再生してください。'); return false; }
    if (token !== this.token[type]) { this.release(entry); return false; }
    if (type === 'song') { this.release(current); if (this.settings.autoDuck) void this.stopBgm(true); }
    else { await this.fade(current); if (token === this.token[type]) this.release(current); }
    if (token !== this.token[type]) { this.release(entry); return false; }
    // Rewind any muted warm-up, then make this the only audible channel.
    entry.audio.currentTime = 0;
    if (entry.audio.paused) { try { await entry.audio.play(); } catch { this.release(entry); return false; } }
    if (token !== this.token[type] || entry.disposed) { this.release(entry); return false; }
    this.pending.delete(entry); entry.gain = 1; this.channels[type] = entry; this.volume(entry); this.onChange(); return true;
  }
  pause(type) { ++this.token[type]; for (const item of [...this.pending]) if (item.type === type) this.release(item); const entry = this.channels[type]; if (entry) { if (entry.timer) { clearInterval(entry.timer); entry.timer = null; entry.finishFade?.(); entry.finishFade = null; } entry.audio.pause(); entry.gain = 1; this.volume(entry); } this.onChange(); }
  stop(type) { ++this.token[type]; for (const entry of [...this.pending]) if (entry.type === type) this.release(entry); this.release(this.channels[type]); this.onChange(); }
  async stopBgm(fade = false) { const token = ++this.token.bgm; for (const item of [...this.pending]) if (item.type === 'bgm') this.release(item); const entry = this.channels.bgm; if (fade) await this.fade(entry, 650); if (token === this.token.bgm) this.release(entry); this.onChange(); }
  stopEffects() { this.effectToken = (this.effectToken || 0) + 1; for (const entry of [...this.effects]) this.release(entry); this.onChange(); }
  stopAll() { this.stopEffects(); this.stop('song'); this.stop('bgm'); }
  stopId(id) { for (const entry of [...this.effects]) if (entry.id === id) this.release(entry); for (const entry of [...this.pending]) if (entry.id === id) { ++this.token[entry.type]; this.release(entry); } for (const type of ['song', 'bgm']) if (this.channels[type]?.id === id) this.stop(type); }
  setLoop(loop) { this.settings.loop = loop; if (this.channels.bgm) this.channels.bgm.audio.loop = loop; }
}

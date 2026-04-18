// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — audio.js (v2)
// Effets sonores : fichiers MP3 dans /sounds/
// Musique d'ambiance : synthèse Web Audio
// ═══════════════════════════════════════════════════════════════

let audioCtx = null;
let musicNodes = null;
let musicGain = null;
let musicEnabled = true;
let sfxEnabled = true;

// Cache des sons chargés
const sfxCache = {};

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Chargement d'un fichier MP3 ───────────────────────────────
async function loadSound(name) {
  if (sfxCache[name]) return sfxCache[name];
  try {
    const ctx = getCtx();
    const response = await fetch(`/sounds/${name}.mp3`);
    if (!response.ok) throw new Error(`Sound not found: ${name}`);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    sfxCache[name] = audioBuffer;
    return audioBuffer;
  } catch (e) {
    console.warn(`Son manquant : ${name}.mp3`, e);
    return null;
  }
}

// ── Lecture d'un son ─────────────────────────────────────────
async function playSound(name, volume = 1.0) {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const buffer = await loadSound(name);
  if (!buffer) return;
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();
  gainNode.gain.value = volume;
  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(ctx.destination);
  source.start(0);
}

// Préchargement de tous les sons au démarrage
async function preloadSounds() {
  const names = ['miss', 'hit', 'sunk', 'atomic', 'weapon', 'victory', 'defeat'];
  await Promise.all(names.map(n => loadSound(n)));
}

// ── EFFETS SONORES EXPORTÉS ───────────────────────────────────
export function sfxMiss()           { playSound('miss',    0.8); }
export function sfxHit()            { playSound('hit',     0.9); }
export function sfxSunk()           { playSound('sunk',    1.0); }
export function sfxAtomic()         { playSound('atomic',  1.0); }
export function sfxWeaponReceived() { playSound('weapon',  0.8); }
export function sfxVictory()        { playSound('victory', 1.0); }
export function sfxDefeat()         { playSound('defeat',  0.9); }
export function sfxReplay()         { playSound('weapon',  0.5); }

// ── MUSIQUE D'AMBIANCE (synthèse conservée) ───────────────────
export function startMusic() {
  if (!musicEnabled) return;
  const ctx = getCtx();
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.18;
    musicGain.connect(ctx.destination);
  }
  stopMusic();
  musicNodes = [];

  const BPM = 72;
  const beat = 60 / BPM;
  const bar = beat * 4;
  const loopLen = bar * 8;

  function scheduleLoop(startTime) {
    const nodes = [];

    // Basse continue
    for (let b = 0; b < 32; b++) {
      const t = startTime + b * beat;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 65.4;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
      osc.connect(g); g.connect(musicGain);
      osc.start(t); osc.stop(t + beat);
      nodes.push(osc, g);
    }

    // Nappe de cordes
    const chords = [
      [130.8, 164.8, 196.0],
      [130.8, 155.6, 196.0],
      [110.0, 138.6, 164.8],
      [116.5, 146.8, 174.6],
    ];
    chords.forEach((chord, ci) => {
      const t = startTime + ci * bar * 2;
      chord.forEach(freq => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.5);
        g.gain.setValueAtTime(0.15, t + bar * 2 - 0.5);
        g.gain.linearRampToValueAtTime(0, t + bar * 2);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + bar * 2);
        nodes.push(osc, g);
      });
    });

    // Mélodie
    const melody = [
      {f:392.0,b:0,d:1.5},{f:349.2,b:2,d:1.0},{f:329.6,b:4,d:0.5},
      {f:349.2,b:6,d:1.0},{f:392.0,b:8,d:2.0},{f:440.0,b:12,d:1.5},
      {f:392.0,b:14,d:1.0},{f:349.2,b:16,d:1.5},{f:329.6,b:18,d:1.0},
      {f:293.7,b:20,d:2.0},{f:329.6,b:24,d:1.5},{f:349.2,b:26,d:1.0},
      {f:392.0,b:28,d:3.0},
    ];
    melody.forEach(note => {
      const t = startTime + note.b * beat;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.08);
      g.gain.setValueAtTime(0.12, t + note.d * beat - 0.1);
      g.gain.linearRampToValueAtTime(0, t + note.d * beat);
      osc.connect(g); g.connect(musicGain);
      osc.start(t); osc.stop(t + note.d * beat + 0.1);
      nodes.push(osc, g);
    });

    // Percussions
    for (let b = 0; b < 32; b++) {
      const t = startTime + b * beat;
      if (b % 4 === 0 || b % 4 === 2) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.2);
        nodes.push(osc, g);
      }
      if (b % 2 === 1) {
        const bufSize = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass'; filter.frequency.value = 8000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(filter); filter.connect(g); g.connect(musicGain);
        src.start(t); src.stop(t + 0.06);
        nodes.push(src, g);
      }
    }

    musicNodes = nodes;
    const loopTimer = setTimeout(() => scheduleLoop(ctx.currentTime), (loopLen - 0.1) * 1000);
    musicNodes.push({ stop: () => clearTimeout(loopTimer) });
  }

  scheduleLoop(ctx.currentTime + 0.1);
}

export function stopMusic() {
  if (musicNodes) {
    musicNodes.forEach(n => { try { if (n.stop) n.stop(); } catch(e) {} });
    musicNodes = null;
  }
}

export function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (musicEnabled) startMusic(); else stopMusic();
  return musicEnabled;
}

export function toggleSfx() {
  sfxEnabled = !sfxEnabled;
  return sfxEnabled;
}

export function initAudio() {
  const start = () => {
    getCtx();
    preloadSounds();
    startMusic();
    document.removeEventListener('click', start);
    document.removeEventListener('keydown', start);
  };
  document.addEventListener('click', start);
  document.addEventListener('keydown', start);
}

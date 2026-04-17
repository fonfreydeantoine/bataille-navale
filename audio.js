// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — audio.js
// Synthèse sonore 100% Web Audio API, aucun fichier externe
// ═══════════════════════════════════════════════════════════════

let audioCtx = null;
let musicNodes = null;
let musicGain = null;
let sfxGain = null;
let musicEnabled = true;
let sfxEnabled = true;

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// ── Utilitaires de synthèse ───────────────────────────────────

function playTone(freq, type, startTime, duration, gainVal, ctx, dest) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  g.gain.setValueAtTime(gainVal, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(g); g.connect(dest);
  osc.start(startTime); osc.stop(startTime + duration);
}

function playNoise(startTime, duration, gainVal, ctx, dest) {
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(800, startTime);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  source.connect(filter); filter.connect(g); g.connect(dest);
  source.start(startTime); source.stop(startTime + duration);
}

// ── EFFETS SONORES ────────────────────────────────────────────

export function sfxMiss() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Plouf : descente de fréquence + bruit
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.5);
  playNoise(t + 0.05, 0.3, 0.15, ctx, dest);
}

export function sfxHit() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Explosion courte : bruit + sub-bass punch
  playNoise(t, 0.15, 0.6, ctx, dest);
  playTone(80, "square", t, 0.2, 0.5, ctx, dest);
  playTone(120, "sawtooth", t, 0.15, 0.3, ctx, dest);
  // Crack
  playNoise(t + 0.05, 0.1, 0.4, ctx, dest);
}

export function sfxSunk() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Grande explosion + grondement
  playNoise(t, 0.6, 0.8, ctx, dest);
  playTone(55, "square", t, 0.8, 0.6, ctx, dest);
  playTone(80, "sawtooth", t, 0.5, 0.4, ctx, dest);
  playTone(40, "sine", t + 0.1, 1.0, 0.5, ctx, dest);
  // Crépitement final
  playNoise(t + 0.3, 0.5, 0.3, ctx, dest);
  // Petite mélodie descendante dramatique
  [440, 330, 220, 165].forEach((f, i) => {
    playTone(f, "sine", t + 0.1 + i * 0.12, 0.15, 0.2, ctx, dest);
  });
}

export function sfxAtomic() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Montée de tension
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(60, t);
  osc.frequency.exponentialRampToValueAtTime(400, t + 0.5);
  g.gain.setValueAtTime(0.1, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.6);
  // Déflagration massive
  playNoise(t + 0.5, 1.2, 1.0, ctx, dest);
  playTone(30, "sine", t + 0.5, 1.5, 0.8, ctx, dest);
  playTone(55, "square", t + 0.5, 1.0, 0.5, ctx, dest);
  // Écho
  playNoise(t + 0.9, 0.8, 0.4, ctx, dest);
  playTone(30, "sine", t + 1.0, 1.0, 0.3, ctx, dest);
}

export function sfxWeaponReceived() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Petite fanfare montante joyeuse
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    playTone(f, "sine", t + i * 0.1, 0.15, 0.3, ctx, dest);
    playTone(f * 1.5, "sine", t + i * 0.1, 0.1, 0.1, ctx, dest);
  });
}

export function sfxVictory() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Fanfare de victoire
  const melody = [523, 523, 523, 659, 523, 659, 784];
  const durations = [0.15, 0.15, 0.15, 0.4, 0.15, 0.15, 0.6];
  let time = t;
  melody.forEach((f, i) => {
    playTone(f, "square", time, durations[i] * 0.9, 0.3, ctx, dest);
    playTone(f / 2, "sine", time, durations[i] * 0.9, 0.2, ctx, dest);
    time += durations[i];
  });
}

export function sfxDefeat() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Mélodie descendante triste
  const melody = [392, 349, 330, 294, 262];
  melody.forEach((f, i) => {
    playTone(f, "sine", t + i * 0.25, 0.3, 0.25, ctx, dest);
    playTone(f * 0.75, "sine", t + i * 0.25, 0.3, 0.1, ctx, dest);
  });
}

export function sfxReplay() {
  if (!sfxEnabled) return;
  const ctx = getCtx();
  const dest = getSfxDest(ctx);
  const t = ctx.currentTime;
  // Son de rechargement
  [200, 300, 400].forEach((f, i) => {
    playTone(f, "square", t + i * 0.08, 0.1, 0.15, ctx, dest);
  });
}

function getSfxDest(ctx) {
  if (!sfxGain) {
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.7;
    sfxGain.connect(ctx.destination);
  }
  return sfxGain;
}

// ── MUSIQUE D'AMBIANCE ────────────────────────────────────────
// Générée algorithmiquement : boucle de 8 mesures,
// ambiance maritime tendue avec basse continue, mélodie flottante

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

    // ── Basse continue (pédale de do) ──
    for (let b = 0; b < 32; b++) {
      const t = startTime + b * beat;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 65.4; // C2
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
      osc.connect(g); g.connect(musicGain);
      osc.start(t); osc.stop(t + beat);
      nodes.push(osc, g);
    }

    // ── Nappe de cordes (pad) ──
    const chords = [
      [130.8, 164.8, 196.0], // C3 E3 G3
      [130.8, 155.6, 196.0], // C3 Eb3 G3
      [110.0, 138.6, 164.8], // A2 C#3 E3
      [116.5, 146.8, 174.6], // Bb2 D3 F3
    ];
    chords.forEach((chord, ci) => {
      const t = startTime + ci * bar * 2;
      chord.forEach(freq => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
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

    // ── Mélodie flottante ──
    const melody = [
      { f: 392.0, b: 0,  d: 1.5 },
      { f: 349.2, b: 2,  d: 1.0 },
      { f: 329.6, b: 4,  d: 0.5 },
      { f: 349.2, b: 6,  d: 1.0 },
      { f: 392.0, b: 8,  d: 2.0 },
      { f: 440.0, b: 12, d: 1.5 },
      { f: 392.0, b: 14, d: 1.0 },
      { f: 349.2, b: 16, d: 1.5 },
      { f: 329.6, b: 18, d: 1.0 },
      { f: 293.7, b: 20, d: 2.0 },
      { f: 329.6, b: 24, d: 1.5 },
      { f: 349.2, b: 26, d: 1.0 },
      { f: 392.0, b: 28, d: 3.0 },
    ];
    melody.forEach(note => {
      const t = startTime + note.b * beat;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.08);
      g.gain.setValueAtTime(0.12, t + note.d * beat - 0.1);
      g.gain.linearRampToValueAtTime(0, t + note.d * beat);
      osc.connect(g); g.connect(musicGain);
      osc.start(t); osc.stop(t + note.d * beat + 0.1);
      nodes.push(osc, g);
    });

    // ── Percussion légère (hi-hat + kick) ──
    for (let b = 0; b < 32; b++) {
      const t = startTime + b * beat;
      // Kick sur les temps 1 et 3
      if (b % 4 === 0 || b % 4 === 2) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.2);
        nodes.push(osc, g);
      }
      // Hi-hat discret
      if (b % 2 === 1) {
        const bufSize = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 8000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(filter); filter.connect(g); g.connect(musicGain);
        src.start(t); src.stop(t + 0.06);
        nodes.push(src, g);
      }
    }

    musicNodes = nodes;

    // Relancer la boucle
    const loopTimer = setTimeout(() => scheduleLoop(ctx.currentTime), (loopLen - 0.1) * 1000);
    musicNodes.push({ stop: () => clearTimeout(loopTimer) });
  }

  scheduleLoop(ctx.currentTime + 0.1);
}

export function stopMusic() {
  if (musicNodes) {
    musicNodes.forEach(n => { try { if(n.stop) n.stop(); } catch(e){} });
    musicNodes = null;
  }
}

export function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (musicEnabled) startMusic();
  else stopMusic();
  return musicEnabled;
}

export function toggleSfx() {
  sfxEnabled = !sfxEnabled;
  return sfxEnabled;
}

export function initAudio() {
  // Démarrer l'audio au premier clic utilisateur (politique navigateur)
  const start = () => {
    startMusic();
    document.removeEventListener("click", start);
    document.removeEventListener("keydown", start);
  };
  document.addEventListener("click", start);
  document.addEventListener("keydown", start);
}

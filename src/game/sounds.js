// All sounds generated via Web Audio API — no files needed.

let ctx = null;
let masterGain = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function out() {
  getCtx();
  return masterGain;
}

export function setMuted(val) {
  if (masterGain) masterGain.gain.value = val ? 0 : 1;
}

// ── Background theme ──────────────────────────────────────────────────────────

const BG_TEMPO   = 0.46;  // seconds per beat (~130 BPM)
const BG_SCALE   = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25]; // C pentatonic
// Two-bar arpeggio pattern (indices into BG_SCALE)
const BG_PATTERN = [0, 2, 4, 2, 5, 4, 2, 4, 1, 2, 4, 2, 3, 4, 2, 0];
const BG_BASS    = [130.81, 130.81, 174.61, 130.81]; // C2 C2 F2 C2 chord cycle
const LOOK_AHEAD = 0.28;
const SCHED_MS   = 110;

let bgPlaying    = false;
let bgNextBeat   = 0;
let bgBeatIdx    = 0;
let bgBassIdx    = 0;
let bgTimer      = null;

function scheduleBg() {
  if (!bgPlaying) return;
  const c = getCtx();
  const now = c.currentTime;

  while (bgNextBeat < now + LOOK_AHEAD) {
    const t = bgNextBeat;
    const beat = bgBeatIdx;

    // Arpeggio — triangle wave, one octave up, quiet
    const freq = BG_SCALE[BG_PATTERN[beat % BG_PATTERN.length]] * 2;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + BG_TEMPO * 0.85);
    osc.connect(g); g.connect(masterGain);
    osc.start(t); osc.stop(t + BG_TEMPO);

    // Bass pad — changes every 4 beats, very slow decay
    if (beat % 4 === 0) {
      const bassFreq = BG_BASS[bgBassIdx % BG_BASS.length];
      const bosc = c.createOscillator();
      bosc.type = 'sine';
      bosc.frequency.value = bassFreq;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.048, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + BG_TEMPO * 4.2);
      bosc.connect(bg); bg.connect(masterGain);
      bosc.start(t); bosc.stop(t + BG_TEMPO * 4.4);
      bgBassIdx++;
    }

    bgNextBeat += BG_TEMPO;
    bgBeatIdx = (bgBeatIdx + 1) % BG_PATTERN.length;
  }

  bgTimer = setTimeout(scheduleBg, SCHED_MS);
}

export function startBgTheme() {
  if (bgPlaying) return;
  bgPlaying = true;
  bgNextBeat = getCtx().currentTime + 0.12;
  bgBeatIdx = 0;
  bgBassIdx = 0;
  scheduleBg();
}

export function stopBgTheme() {
  bgPlaying = false;
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noise(ctx, duration) {
  const size = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

// ── Sounds ────────────────────────────────────────────────────────────────────

// Short whoosh — human is airy, bot is duller/mechanical
export function playMove(isBot = false) {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const src = noise(ctx, 0.1);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(isBot ? 400 : 900, t);
  filter.frequency.exponentialRampToValueAtTime(isBot ? 160 : 320, t + 0.09);
  filter.Q.value = 1.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(isBot ? 0.07 : 0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  src.connect(filter); filter.connect(g); g.connect(out());
  src.start(t); src.stop(t + 0.13);
}

// Ink-stamp thwack as territory fills in
export function playClaim() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(95, t + 0.13);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  // transient click
  const click = noise(ctx, 0.015);
  const cg = ctx.createGain();
  cg.gain.value = 0.22;
  osc.connect(g); g.connect(out());
  click.connect(cg); cg.connect(out());
  osc.start(t); osc.stop(t + 0.26);
  click.start(t);
}

// Single soft ping — gentle nudge, not a fanfare
export function playYourTurn() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 880;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.055, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.5);
}

// Short tick — urgency 0→1 raises pitch
export function playTick(urgency = 0) {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 580 + urgency * 440;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.055, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.05);
}

// Descending three-note "wah wah wah"
export function playElimination() {
  const ctx = getCtx();
  [392, 330, 262].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.22;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 1.04, t);
    osc.frequency.linearRampToValueAtTime(freq * 0.93, t + 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(380, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.38);
  });
}

// Ascending double sparkle
export function playBoost() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  [[440, 1320, 0], [660, 1760, 0.09]].forEach(([f0, f1, delay]) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t + delay);
    osc.frequency.exponentialRampToValueAtTime(f1, t + delay + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(delay ? 0.13 : 0.22, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.45);
    osc.connect(g); g.connect(out());
    osc.start(t + delay); osc.stop(t + delay + 0.5);
  });
}

// Low thud + debris rattle
export function playBomb() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.24);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.65, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.42);
  // debris
  const src = noise(ctx, 0.28);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800; filter.Q.value = 0.6;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.18, t + 0.05);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.44);
  src.connect(filter); filter.connect(gn); gn.connect(out());
  src.start(t + 0.05); src.stop(t + 0.5);
}

// Ascending crystalline arpeggio
export function playFreeze() {
  const ctx = getCtx();
  [1047, 1319, 1568, 2093, 2637].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.055;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.62);
  });
}

// LFO-warped sine — slightly sci-fi, slightly silly
export function playPortal() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, t);
  osc.frequency.linearRampToValueAtTime(660, t + 0.55);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(5, t);
  lfo.frequency.linearRampToValueAtTime(16, t + 0.55);
  const lfoG = ctx.createGain();
  lfoG.gain.value = 90;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  osc.connect(g); g.connect(out());
  lfo.start(t); osc.start(t);
  lfo.stop(t + 0.8); osc.stop(t + 0.8);
}

// Rising arpeggio + held chord
export function playWin() {
  const ctx = getCtx();
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.1;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 1.1);
  });
  [523.25, 659.25, 783.99].forEach(freq => {
    const t = ctx.currentTime + 0.4;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 1.95);
  });
}

// Two notes that just… stop
export function playDraw() {
  const ctx = getCtx();
  [523.25, 659.25].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.12;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.6);
  });
  // deflating note
  const t2 = ctx.currentTime + 0.26;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, t2);
  osc.frequency.exponentialRampToValueAtTime(200, t2 + 0.42);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.14, t2);
  g.gain.exponentialRampToValueAtTime(0.001, t2 + 0.52);
  osc.connect(filter); filter.connect(g); g.connect(out());
  osc.start(t2); osc.stop(t2 + 0.58);
}

// Deep kick drum
export function playCountdownBeat() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(44, t + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.42);
}

// Swooshy two-note indicator — "pick someone"
export function playSwapActivate() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.18);
  osc.frequency.exponentialRampToValueAtTime(660, t + 0.34);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.55);
  // high sparkle
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1760, t + 0.08);
  osc2.frequency.exponentialRampToValueAtTime(2637, t + 0.3);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0, t + 0.08);
  g2.gain.linearRampToValueAtTime(0.1, t + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  osc2.connect(g2); g2.connect(out());
  osc2.start(t + 0.08); osc2.stop(t + 0.52);
}

// Double-whoosh zip — positions exchanged
export function playSwap() {
  const ctx = getCtx();
  const t = ctx.currentTime;
  [[660, 220, 0], [220, 660, 0.12]].forEach(([f0, f1, delay]) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t + delay);
    osc.frequency.exponentialRampToValueAtTime(f1, t + delay + 0.22);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t + delay);
    filter.frequency.exponentialRampToValueAtTime(400, t + delay + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.32);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t + delay); osc.stop(t + delay + 0.36);
  });
}

// Warm rising chord
export function playCountdownGo() {
  const ctx = getCtx();
  [392, 523.25, 659.25].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.07;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 1.55);
  });
}

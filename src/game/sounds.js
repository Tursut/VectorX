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

// Call on any user gesture to un-suspend the AudioContext after backgrounding
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// ── Cheap room reverb helper ──────────────────────────────────────────────────
// A short delay + feedback loop that adds warmth without a ConvolverNode.
function makeReverb(c, delayTime = 0.06, feedback = 0.22, wet = 0.18) {
  const delay = c.createDelay(0.5);
  delay.delayTime.value = delayTime;
  const fbGain = c.createGain();
  fbGain.gain.value = feedback;
  const wetGain = c.createGain();
  wetGain.gain.value = wet;
  delay.connect(fbGain);
  fbGain.connect(delay);
  delay.connect(wetGain);
  wetGain.connect(masterGain);
  return delay; // send audio here to add reverb
}

// ── Background theme ──────────────────────────────────────────────────────────

const BG_TEMPO   = 0.34;  // seconds per beat (~176 BPM — lively and jolly)
const BG_SCALE   = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33]; // C4 maj pentatonic + D5
// 64-beat jolly pattern — 4 distinct phrases, ~22s before looping
const BG_PATTERN = [
  // Phrase A — bouncy leaps, bright and ascending
  0, 3, 2, 3, 5, 3, 2, 3,
  0, 2, 3, 5, 3, 2, 0, 2,
  // Phrase B — climbs to the top, energetic answer
  2, 3, 5, 6, 5, 3, 5, 3,
  2, 3, 2, 0, 2, 3, 2, 0,
  // Phrase C — sits around A4, more playful/syncopated feel
  4, 5, 4, 3, 4, 5, 6, 5,
  4, 3, 4, 3, 2, 0, 2, 3,
  // Phrase D — rises from the bottom, builds to a peak
  0, 1, 2, 3, 4, 3, 2, 3,
  5, 4, 3, 4, 5, 3, 2, 0,
];
// Bass: C2 F2 C2 G2 F2 C2 G2 C2 — 8-step cycle, changes character each phrase
const BG_BASS    = [130.81, 174.61, 130.81, 196.00, 174.61, 130.81, 196.00, 130.81];
const LOOK_AHEAD = 0.28;
const SCHED_MS   = 110;

let bgPlaying  = false;
let bgNextBeat = 0;
let bgBeatIdx  = 0;
let bgBassIdx  = 0;
let bgTimer    = null;

function scheduleBg() {
  if (!bgPlaying) return;
  const c = getCtx();
  const now = c.currentTime;

  while (bgNextBeat < now + LOOK_AHEAD) {
    const t    = bgNextBeat;
    const beat = bgBeatIdx;

    // Melody — triangle + detuned sawtooth, warm middle register
    const freq = BG_SCALE[BG_PATTERN[beat % BG_PATTERN.length]];

    const osc1 = c.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = freq;

    const osc2 = c.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = freq;
    osc2.detune.value = 7;

    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.034, t + 0.016);
    g.gain.exponentialRampToValueAtTime(0.001, t + BG_TEMPO * 0.80);

    const g2 = c.createGain();
    g2.gain.value = 0.012;

    osc1.connect(g); g.connect(masterGain);
    osc2.connect(g2); g2.connect(masterGain);
    osc1.start(t); osc1.stop(t + BG_TEMPO);
    osc2.start(t); osc2.stop(t + BG_TEMPO);

    // Bass pulse every 2 beats — louder and more present
    if (beat % 2 === 0) {
      const bassFreq = BG_BASS[bgBassIdx % BG_BASS.length];
      const bosc = c.createOscillator();
      bosc.type = 'sine';
      bosc.frequency.value = bassFreq;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.10, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + BG_TEMPO * 2.1);
      bosc.connect(bg); bg.connect(masterGain);
      bosc.start(t); bosc.stop(t + BG_TEMPO * 2.2);

      // Mid-range octave double for warmth on mobile speakers
      const bosc2 = c.createOscillator();
      bosc2.type = 'triangle';
      bosc2.frequency.value = bassFreq * 2;
      const bg2 = c.createGain();
      bg2.gain.setValueAtTime(0.04, t);
      bg2.gain.exponentialRampToValueAtTime(0.001, t + BG_TEMPO * 1.6);
      bosc2.connect(bg2); bg2.connect(masterGain);
      bosc2.start(t); bosc2.stop(t + BG_TEMPO * 1.8);

      bgBassIdx++;
    }

    // Light hi-hat every beat — rhythmic drive
    const hat = noise(c, 0.02);
    const hf = c.createBiquadFilter();
    hf.type = 'highpass'; hf.frequency.value = 7000;
    const hg = c.createGain();
    hg.gain.setValueAtTime(beat % 2 === 0 ? 0.03 : 0.015, t);
    hg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    hat.connect(hf); hf.connect(hg); hg.connect(masterGain);
    hat.start(t); hat.stop(t + 0.04);

    bgNextBeat += BG_TEMPO;
    bgBeatIdx = (bgBeatIdx + 1) % BG_PATTERN.length;
  }

  bgTimer = setTimeout(scheduleBg, SCHED_MS);
}

export function startBgTheme() {
  if (bgPlaying) return;
  bgPlaying = true;
  bgNextBeat = getCtx().currentTime + 0.12;
  bgBeatIdx  = 0;
  bgBassIdx  = 0;
  scheduleBg();
}

export function stopBgTheme() {
  bgPlaying = false;
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noise(ctx, duration) {
  const size = Math.floor(ctx.sampleRate * duration);
  const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
  const d    = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

// ── Sounds ────────────────────────────────────────────────────────────────────

// Short whoosh — human is airy/bright, bot is duller/mechanical
export function playMove(isBot = false) {
  const c = getCtx();
  const t = c.currentTime;
  const src = noise(c, 0.15);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(isBot ? 420 : 1100, t);
  filter.frequency.exponentialRampToValueAtTime(isBot ? 160 : 380, t + 0.12);
  filter.Q.value = 1.6;
  const g = c.createGain();
  g.gain.setValueAtTime(isBot ? 0.09 : 0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(filter); filter.connect(g); g.connect(out());
  src.start(t); src.stop(t + 0.18);
}

// Ink-stamp thwack as territory fills in
export function playClaim() {
  const c = getCtx();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(88, t + 0.14);
  const g = c.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  const click = noise(c, 0.015);
  const cg = c.createGain();
  cg.gain.value = 0.25;
  osc.connect(g); g.connect(out());
  click.connect(cg); cg.connect(out());
  osc.start(t); osc.stop(t + 0.28);
  click.start(t);
}

// Single soft ping — gentle nudge, not a fanfare
export function playYourTurn() {
  const c = getCtx();
  const t = c.currentTime;
  // Two detuned sines for warmth
  [880, 881.5].forEach(freq => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.032, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.55);
  });
}

// Short tick — urgency 0→1 raises pitch
export function playTick(urgency = 0) {
  const c = getCtx();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 580 + urgency * 440;
  const g = c.createGain();
  g.gain.setValueAtTime(0.055, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.05);
}

// Descending "wah wah wah" with reverb tail for drama
export function playElimination() {
  const c = getCtx();
  const rev = makeReverb(c, 0.08, 0.28, 0.22);
  [392, 330, 220].forEach((freq, i) => {
    const t = c.currentTime + i * 0.24;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = -4;
    osc.frequency.setValueAtTime(freq * 1.04, t);
    osc.frequency.linearRampToValueAtTime(freq * 0.92, t + 0.22);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(360, t + 0.24);
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    osc.connect(filter); filter.connect(g);
    g.connect(out());
    g.connect(rev);
    osc.start(t); osc.stop(t + 0.42);
  });
}

// Ascending double sparkle
export function playBoost() {
  const c = getCtx();
  const t = c.currentTime;
  [[440, 1320, 0], [660, 1760, 0.09]].forEach(([f0, f1, delay]) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t + delay);
    osc.frequency.exponentialRampToValueAtTime(f1, t + delay + 0.28);
    const g = c.createGain();
    g.gain.setValueAtTime(delay ? 0.13 : 0.22, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.45);
    osc.connect(g); g.connect(out());
    osc.start(t + delay); osc.stop(t + delay + 0.5);
  });
}

// Low thud + debris rattle
export function playBomb() {
  const c = getCtx();
  const t = c.currentTime;
  // Main thud — two slightly detuned sines for body
  [110, 113].forEach(freq => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.26);
    const g = c.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.46);
  });
  // Debris rattle
  const src = noise(c, 0.32);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800; filter.Q.value = 0.55;
  const gn = c.createGain();
  gn.gain.setValueAtTime(0.22, t + 0.05);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  src.connect(filter); filter.connect(gn); gn.connect(out());
  src.start(t + 0.05); src.stop(t + 0.54);
}

// Crystalline ascending arpeggio with icy LFO shimmer
export function playFreeze() {
  const c = getCtx();
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(8, c.currentTime);
  lfo.frequency.linearRampToValueAtTime(14, c.currentTime + 0.65);
  const lfoG = c.createGain();
  lfoG.gain.value = 20; // pitch wobble depth in cents equivalent via freq

  [1047, 1319, 1568, 2093, 2637].forEach((freq, i) => {
    const t = c.currentTime + i * 0.058;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = 4;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.68);
  });
  lfo.start(c.currentTime);
  lfo.stop(c.currentTime + 0.72);
}

// LFO-warped sine — slightly sci-fi, slightly silly
export function playPortal() {
  const c = getCtx();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, t);
  osc.frequency.linearRampToValueAtTime(660, t + 0.55);
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(5, t);
  lfo.frequency.linearRampToValueAtTime(18, t + 0.55);
  const lfoG = c.createGain();
  lfoG.gain.value = 90;
  const g = c.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  osc.connect(g); g.connect(out());
  lfo.start(t); osc.start(t);
  lfo.stop(t + 0.8); osc.stop(t + 0.8);
}

// Rising arpeggio + held chord + triumphant second hit
export function playWin() {
  const c = getCtx();
  const rev = makeReverb(c, 0.12, 0.32, 0.3);

  // Arpeggio
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const t = c.currentTime + i * 0.1;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = -3;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.17, t);
    g.gain.linearRampToValueAtTime(0.21, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    osc.connect(filter); filter.connect(g);
    g.connect(out()); g.connect(rev);
    osc.start(t); osc.stop(t + 1.15);
  });

  // Held chord
  [523.25, 659.25, 783.99].forEach(freq => {
    const t = c.currentTime + 0.38;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 2.1);
  });

  // Second triumphant chord hit
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const t = c.currentTime + 0.82 + i * 0.06;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    osc.connect(filter); filter.connect(g);
    g.connect(out()); g.connect(rev);
    osc.start(t); osc.stop(t + 1.0);
  });
}

// Two notes that just… stop
export function playDraw() {
  const c = getCtx();
  [523.25, 659.25].forEach((freq, i) => {
    const t = c.currentTime + i * 0.12;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.6);
  });
  const t2 = c.currentTime + 0.26;
  const oscD = c.createOscillator();
  oscD.type = 'sawtooth';
  oscD.frequency.setValueAtTime(440, t2);
  oscD.frequency.exponentialRampToValueAtTime(200, t2 + 0.42);
  const filterD = c.createBiquadFilter();
  filterD.type = 'lowpass'; filterD.frequency.value = 1400;
  const gD = c.createGain();
  gD.gain.setValueAtTime(0.14, t2);
  gD.gain.exponentialRampToValueAtTime(0.001, t2 + 0.52);
  oscD.connect(filterD); filterD.connect(gD); gD.connect(out());
  oscD.start(t2); oscD.stop(t2 + 0.58);
}

// Deep kick drum with noise transient on attack
export function playCountdownBeat() {
  const c = getCtx();
  const t = c.currentTime;
  // Main kick body — two detuned sines for fatness
  [180, 184].forEach(freq => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.28);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + 0.44);
  });
  // Attack transient — gives it punch
  const click = noise(c, 0.025);
  const cf = c.createBiquadFilter();
  cf.type = 'highpass'; cf.frequency.value = 2000;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.28, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  click.connect(cf); cf.connect(cg); cg.connect(out());
  click.start(t); click.stop(t + 0.03);
}

// Sharp descending whoosh + sparkle — actual teleport jump
export function playPortalJump() {
  const c = getCtx();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(920, t);
  osc.frequency.exponentialRampToValueAtTime(175, t + 0.24);
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.38);
  // Arrival sparkle
  [1047, 1568, 2093].forEach((freq, i) => {
    const ts = t + 0.16 + i * 0.058;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = 4;
    const og = c.createGain();
    og.gain.setValueAtTime(0, ts);
    og.gain.linearRampToValueAtTime(0.1, ts + 0.012);
    og.gain.exponentialRampToValueAtTime(0.001, ts + 0.4);
    o.connect(og); og.connect(out());
    o.start(ts); o.stop(ts + 0.44);
  });
}

// Swooshy two-note indicator — "pick someone"
export function playSwapActivate() {
  const c = getCtx();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.18);
  osc.frequency.exponentialRampToValueAtTime(660, t + 0.34);
  const g = c.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(out());
  osc.start(t); osc.stop(t + 0.55);
  const osc2 = c.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1760, t + 0.08);
  osc2.frequency.exponentialRampToValueAtTime(2637, t + 0.3);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t + 0.08);
  g2.gain.linearRampToValueAtTime(0.1, t + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  osc2.connect(g2); g2.connect(out());
  osc2.start(t + 0.08); osc2.stop(t + 0.52);
}

// Double-whoosh zip — positions exchanged
export function playSwap() {
  const c = getCtx();
  const t = c.currentTime;
  [[660, 220, 0], [220, 660, 0.12]].forEach(([f0, f1, delay]) => {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t + delay);
    osc.frequency.exponentialRampToValueAtTime(f1, t + delay + 0.22);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t + delay);
    filter.frequency.exponentialRampToValueAtTime(400, t + delay + 0.24);
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.32);
    osc.connect(filter); filter.connect(g); g.connect(out());
    osc.start(t + delay); osc.stop(t + delay + 0.36);
  });
}

// Warm rising chord — "GO!"
export function playCountdownGo() {
  const c = getCtx();
  const rev = makeReverb(c, 0.08, 0.24, 0.2);
  [392, 523.25, 659.25].forEach((freq, i) => {
    const t = c.currentTime + i * 0.07;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = -3;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.19, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    osc.connect(filter); filter.connect(g);
    g.connect(out()); g.connect(rev);
    osc.start(t); osc.stop(t + 1.65);
  });
}

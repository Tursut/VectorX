// All sounds generated via Web Audio API — no files needed.

let ctx = null;
let masterGain = null;

function createContext() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);
  ctx.onstatechange = () => {
    if (ctx.state === 'running' && bgPlaying) {
      clearTimeout(bgTimer); bgTimer = null;
      bgNextBeat = ctx.currentTime + 0.05;
      scheduleBg();
    }
  };
}

// Never auto-recreates a closed context — that must happen from a user gesture in resumeAudio().
// Returning null lets callers fail silently rather than create a tainted context.
function getCtx() {
  if (!ctx || ctx.state === 'closed') return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function out() {
  return masterGain;
}

export function setMuted(val) {
  if (masterGain) masterGain.gain.value = val ? 0 : 1;
}

// Must be called from a user-gesture handler (touchstart / click).
// Recreates the context if closed/missing (iOS can close it when backgrounded),
// then resumes and restarts bg music via onstatechange.
export function resumeAudio() {
  if (!ctx || ctx.state === 'closed') {
    const wasPlaying = bgPlaying;
    clearTimeout(bgTimer); bgTimer = null; bgPlaying = false;
    createContext();
    if (wasPlaying) {
      bgPlaying = true;
      ctx.resume().then(() => {
        bgNextBeat = ctx.currentTime + 0.05;
        clearTimeout(bgTimer); bgTimer = null;
        scheduleBg();
      }).catch(() => {});
    } else {
      ctx.resume().catch(() => {});
    }
    return;
  }
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      if (bgPlaying) {
        clearTimeout(bgTimer); bgTimer = null;
        bgNextBeat = ctx.currentTime + 0.05;
        scheduleBg();
      }
    }).catch(() => {});
  } else if (ctx.state === 'running' && bgPlaying && bgNextBeat < ctx.currentTime - 1.0) {
    // Scheduler fell >1s behind — it silently died (e.g. exception broke the setTimeout chain)
    clearTimeout(bgTimer); bgTimer = null;
    bgNextBeat = ctx.currentTime + 0.05;
    scheduleBg();
  }
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
// Music is split into variants. Each variant owns a `scheduleBeat(c, t, beat)`
// function that schedules everything for one beat, plus a tempo (seconds per
// beat) and loopBeats (how many beats before the pattern repeats). The module
// keeps a single `currentVariantId`; switching at runtime restarts the loop
// from beat 0 at the next scheduler tick.

const LOOK_AHEAD = 0.28;
const SCHED_MS   = 110;

let bgPlaying  = false;
let bgNextBeat = 0;
let bgBeatIdx  = 0;
let bgTimer    = null;
let currentVariantId = 'explorer';

export const BG_VARIANT_LIST = [
  { id: 'explorer', name: 'Explorer',       desc: 'Upbeat C pentatonic — the current theme' },
  { id: 'march',    name: 'Heroic March',   desc: 'Epic battle anthem in D minor, 120 BPM' },
  { id: 'mystic',   name: 'Mystic Grove',   desc: 'Sparse shimmering arpeggio in A minor' },
  { id: 'rally',    name: 'Rallying Cry',   desc: 'Driving triumphant E major, 140 BPM' },
  { id: 'tense',    name: 'Tense Standoff', desc: 'Moody slow pulse in F# minor' },
];

export function setBgVariant(id) {
  if (!BG_VARIANTS[id] || currentVariantId === id) return;
  currentVariantId = id;
  if (bgPlaying) {
    bgBeatIdx = 0;
    const c = getCtx();
    if (c) bgNextBeat = c.currentTime + 0.05;
  }
}

export function getBgVariant() {
  return currentVariantId;
}

// ── Explorer (current theme) ────────────────────────────────────────────────
const EXP_SCALE   = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33]; // C4 maj pent + D5
const EXP_MELODY  = [
  0, 3, 2, 3, 5, 3, 2, 3,   0, 2, 3, 5, 3, 2, 0, 2,
  2, 3, 5, 6, 5, 3, 5, 3,   2, 3, 2, 0, 2, 3, 2, 0,
  4, 5, 4, 3, 4, 5, 6, 5,   4, 3, 4, 3, 2, 0, 2, 3,
  0, 1, 2, 3, 4, 3, 2, 3,   5, 4, 3, 4, 5, 3, 2, 0,
];
const EXP_BASS = [130.81, 174.61, 130.81, 196.00, 174.61, 130.81, 196.00, 130.81];
function scheduleExplorerBeat(c, t, beat, tempo) {
  const freq = EXP_SCALE[EXP_MELODY[beat]];
  const osc1 = c.createOscillator(); osc1.type = 'triangle'; osc1.frequency.value = freq;
  const osc2 = c.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = freq; osc2.detune.value = 7;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.034, t + 0.016);
  g.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.80);
  const g2 = c.createGain(); g2.gain.value = 0.012;
  osc1.connect(g); g.connect(masterGain);
  osc2.connect(g2); g2.connect(masterGain);
  osc1.start(t); osc1.stop(t + tempo);
  osc2.start(t); osc2.stop(t + tempo);

  if (beat % 2 === 0) {
    const bassFreq = EXP_BASS[(beat / 2) % EXP_BASS.length];
    const bosc = c.createOscillator(); bosc.type = 'sine'; bosc.frequency.value = bassFreq;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.10, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 2.1);
    bosc.connect(bg); bg.connect(masterGain);
    bosc.start(t); bosc.stop(t + tempo * 2.2);
    const bosc2 = c.createOscillator(); bosc2.type = 'triangle'; bosc2.frequency.value = bassFreq * 2;
    const bg2 = c.createGain();
    bg2.gain.setValueAtTime(0.04, t);
    bg2.gain.exponentialRampToValueAtTime(0.001, t + tempo * 1.6);
    bosc2.connect(bg2); bg2.connect(masterGain);
    bosc2.start(t); bosc2.stop(t + tempo * 1.8);
  }

  scheduleClosedHat(c, t, beat % 2 === 0 ? 0.03 : 0.015);
}

// ── Heroic March (D minor, 120 BPM) ─────────────────────────────────────────
// 32-beat loop. Chord progression by 8-beat bar: Dm → Bb → F → A.
const MAR_SCALE   = [146.83, 174.61, 220.00, 261.63, 293.66, 349.23, 440.00]; // D3 F3 A3 C4 D4 F4 A4
const MAR_MELODY  = [
  // Dm:      Bb:      F:       A:
  5, 6, 5, 4, 5, 4, 3, 4,   3, 4, 5, 6, 5, 4, 3, 4,
  5, 6, 5, 4, 3, 4, 5, 6,   4, 5, 6, 4, 5, 3, 2, 2,
];
const MAR_CHORD_ROOTS = [73.42, 58.27, 87.31, 110.00]; // D2, Bb1, F2, A2 (one per 8-beat bar)
function scheduleMarchBeat(c, t, beat, tempo) {
  const barIdx = Math.floor(beat / 8);
  const inBar = beat % 8;

  // Lead melody — triangle + saw doubling for warmth
  const freq = MAR_SCALE[MAR_MELODY[beat]];
  const lead = c.createOscillator(); lead.type = 'triangle'; lead.frequency.value = freq;
  const saw  = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = freq; saw.detune.value = -6;
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(0.042, t + 0.02);
  lg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.9);
  const sg = c.createGain(); sg.gain.value = 0.014;
  lead.connect(lg); lg.connect(masterGain);
  saw.connect(sg); sg.connect(masterGain);
  lead.start(t); lead.stop(t + tempo);
  saw.start(t); saw.stop(t + tempo);

  // Sub-bass: root of current bar, held 4 beats (pulses at beat 0 and 4 of bar)
  if (inBar === 0 || inBar === 4) {
    const root = MAR_CHORD_ROOTS[barIdx % MAR_CHORD_ROOTS.length];
    const b1 = c.createOscillator(); b1.type = 'sine'; b1.frequency.value = root;
    const b2 = c.createOscillator(); b2.type = 'triangle'; b2.frequency.value = root * 2;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.16, t + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 3.8);
    const bg2 = c.createGain();
    bg2.gain.setValueAtTime(0.05, t);
    bg2.gain.exponentialRampToValueAtTime(0.001, t + tempo * 2.4);
    b1.connect(bg); bg.connect(masterGain);
    b2.connect(bg2); bg2.connect(masterGain);
    b1.start(t); b1.stop(t + tempo * 4);
    b2.start(t); b2.stop(t + tempo * 2.5);
  }

  // Kick on 1, 3, 5, 7 of the bar (every odd beat)
  if (inBar % 2 === 0) scheduleKick(c, t, 0.32, 0.22);
  // Snare on 3 and 7
  if (inBar === 2 || inBar === 6) scheduleSnare(c, t, 0.11);
  // Hi-hat on every beat
  scheduleClosedHat(c, t, inBar % 2 === 0 ? 0.025 : 0.014);
}

// ── Mystic Grove (A minor, 100 BPM) ─────────────────────────────────────────
// 24-beat loop. Shimmering arpeggio up the scale, sparse sub-bass, no drums.
const MYS_SCALE = [220.00, 261.63, 329.63, 392.00, 440.00, 523.25, 659.25, 783.99]; // A3 C4 E4 G4 A4 C5 E5 G5
const MYS_ARP   = [0, 2, 4, 6, 4, 2, 1, 3, 5, 7, 5, 3, 0, 2, 4, 5, 4, 2, 1, 3, 5, 4, 2, 0];
const MYS_BASS  = [55.00, 55.00, 65.41, 73.42]; // A1 A1 C2 D2 (one per 6-beat group)
function scheduleMysticBeat(c, t, beat, tempo) {
  const groupIdx = Math.floor(beat / 6);

  // Arpeggio — sine with slight detune for sparkle
  const freq = MYS_SCALE[MYS_ARP[beat]];
  const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2; o2.detune.value = 4;
  const g1 = c.createGain();
  g1.gain.setValueAtTime(0, t);
  g1.gain.linearRampToValueAtTime(0.05, t + 0.02);
  g1.gain.exponentialRampToValueAtTime(0.001, t + tempo * 1.6);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(0.018, t + 0.04);
  g2.gain.exponentialRampToValueAtTime(0.001, t + tempo * 1.2);
  o1.connect(g1); g1.connect(masterGain);
  o2.connect(g2); g2.connect(masterGain);
  o1.start(t); o1.stop(t + tempo * 1.8);
  o2.start(t); o2.stop(t + tempo * 1.4);

  // Sub-bass — one deep note at start of each 6-beat group, long decay
  if (beat % 6 === 0) {
    const bass = c.createOscillator(); bass.type = 'sine';
    bass.frequency.value = MYS_BASS[groupIdx % MYS_BASS.length];
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.13, t + 0.06);
    bg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 5.5);
    bass.connect(bg); bg.connect(masterGain);
    bass.start(t); bass.stop(t + tempo * 6);
  }

  // Pad — ambient fifth every 12 beats (half-loop)
  if (beat % 12 === 0) {
    [MYS_SCALE[0] / 2, MYS_SCALE[3] / 2].forEach(f => {
      const p = c.createOscillator(); p.type = 'sawtooth'; p.frequency.value = f;
      const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700;
      const pg = c.createGain();
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(0.018, t + 0.25);
      pg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 11.5);
      p.connect(pf); pf.connect(pg); pg.connect(masterGain);
      p.start(t); p.stop(t + tempo * 12);
    });
  }
}

// ── Rallying Cry (E major, 140 BPM) ─────────────────────────────────────────
// 32-beat loop. Syncopated bass, triumphant brass-like saw lead, claps + hats.
const RAL_SCALE  = [164.81, 207.65, 246.94, 329.63, 369.99, 415.30, 493.88, 659.25]; // E3 G#3 B3 E4 F#4 G#4 B4 E5
const RAL_MELODY = [
  3, 5, 6, 7, 6, 5, 4, 3,   2, 3, 4, 5, 4, 3, 2, 3,
  4, 5, 6, 5, 4, 3, 4, 5,   6, 5, 4, 3, 2, 1, 0, 3,
];
// Syncopated bass — one note per beat, accent on off-beats
const RAL_BASS = [82.41, 82.41, 123.47, 82.41, 98.00, 82.41, 123.47, 82.41]; // E2 pattern
function scheduleRallyBeat(c, t, beat, tempo) {
  const inBar = beat % 8;

  // Brass-like saw lead with lowpass sweep
  const freq = RAL_SCALE[RAL_MELODY[beat]];
  const lead = c.createOscillator(); lead.type = 'sawtooth'; lead.frequency.value = freq;
  const lf = c.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 2200;
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(0.04, t + 0.015);
  lg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.85);
  lead.connect(lf); lf.connect(lg); lg.connect(masterGain);
  lead.start(t); lead.stop(t + tempo);

  // Syncopated bass pulse every beat
  const bassFreq = RAL_BASS[inBar];
  const bass = c.createOscillator(); bass.type = 'sawtooth'; bass.frequency.value = bassFreq;
  const bf = c.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 600;
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.11, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.75);
  bass.connect(bf); bf.connect(bg); bg.connect(masterGain);
  bass.start(t); bass.stop(t + tempo * 0.8);

  // Clap on 2 and 4 of each half-bar (beats 2, 4, 6 of 8)
  if (inBar === 2 || inBar === 6) scheduleClap(c, t, 0.12);
  // Kick on 1 and 5
  if (inBar === 0 || inBar === 4) scheduleKick(c, t, 0.28, 0.18);
  // Hi-hat 8ths
  scheduleClosedHat(c, t, 0.018);
}

// ── Tense Standoff (F# minor, 90 BPM) ───────────────────────────────────────
// 16-beat loop. Sparse piano-ish pulse, deep sub-bass drops, rim shot tick.
const TEN_SCALE = [92.50, 110.00, 138.59, 184.99, 220.00]; // F#2 A2 C#3 F#3 A3
const TEN_PULSE = [0, -1, 2, -1, 1, -1, 3, -1, 0, -1, 2, -1, 4, -1, 3, 1]; // -1 = rest
const TEN_SUB   = 46.25; // F#1
function scheduleTenseBeat(c, t, beat, tempo) {
  const step = TEN_PULSE[beat];

  // Sparse piano-ish tone (FM-ish sine with quick filter decay)
  if (step >= 0) {
    const freq = TEN_SCALE[step];
    const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
    const harm = c.createOscillator(); harm.type = 'sine'; harm.frequency.value = freq * 3; harm.detune.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + tempo * 1.3);
    const gh = c.createGain();
    gh.gain.setValueAtTime(0.012, t);
    gh.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.4);
    osc.connect(g); g.connect(masterGain);
    harm.connect(gh); gh.connect(masterGain);
    osc.start(t); osc.stop(t + tempo * 1.4);
    harm.start(t); harm.stop(t + tempo * 0.5);
  }

  // Deep sub on beat 0 and 8 — anchors the tension
  if (beat === 0 || beat === 8) {
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = TEN_SUB;
    const sg = c.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.18, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.001, t + tempo * 7);
    sub.connect(sg); sg.connect(masterGain);
    sub.start(t); sub.stop(t + tempo * 7.5);
  }

  // Rim-shot tick on off-beats (every odd beat) — drives the tension
  if (beat % 2 === 1) scheduleRim(c, t, 0.06);
}

// ── Drum/percussion helpers used by variants ────────────────────────────────
function scheduleKick(c, t, gain, sweepDur) {
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + sweepDur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + sweepDur + 0.05);
  osc.connect(g); g.connect(masterGain);
  osc.start(t); osc.stop(t + sweepDur + 0.08);
}

function scheduleSnare(c, t, gain) {
  const src = noise(c, 0.12);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start(t); src.stop(t + 0.16);
}

function scheduleClap(c, t, gain) {
  // Three quick noise bursts for that "clap" stack
  [0, 0.012, 0.024].forEach((d, i) => {
    const src = noise(c, 0.04);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.7;
    const g = c.createGain();
    const amp = gain * (i === 2 ? 1 : 0.7);
    g.gain.setValueAtTime(amp, t + d);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.12);
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(t + d); src.stop(t + d + 0.15);
  });
}

function scheduleClosedHat(c, t, gain) {
  const src = noise(c, 0.02);
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start(t); src.stop(t + 0.04);
}

function scheduleRim(c, t, gain) {
  const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = 320;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  osc.connect(g); g.connect(masterGain);
  osc.start(t); osc.stop(t + 0.05);
}

// ── Variant table ───────────────────────────────────────────────────────────
const BG_VARIANTS = {
  explorer: { tempo: 0.34, loopBeats: 64, scheduleBeat: scheduleExplorerBeat },
  march:    { tempo: 0.50, loopBeats: 32, scheduleBeat: scheduleMarchBeat },
  mystic:   { tempo: 0.60, loopBeats: 24, scheduleBeat: scheduleMysticBeat },
  rally:    { tempo: 0.43, loopBeats: 32, scheduleBeat: scheduleRallyBeat },
  tense:    { tempo: 0.67, loopBeats: 16, scheduleBeat: scheduleTenseBeat },
};

function scheduleBg() {
  if (!bgPlaying) return;
  const c = getCtx();
  if (!c || c.state !== 'running') {
    bgTimer = setTimeout(scheduleBg, 500);
    return;
  }
  const v = BG_VARIANTS[currentVariantId] || BG_VARIANTS.explorer;
  const now = c.currentTime;
  if (bgNextBeat < now || bgNextBeat > now + 5) bgNextBeat = now + 0.05;

  try {
    while (bgNextBeat < now + LOOK_AHEAD) {
      v.scheduleBeat(c, bgNextBeat, bgBeatIdx % v.loopBeats, v.tempo);
      bgNextBeat += v.tempo;
      bgBeatIdx = (bgBeatIdx + 1) % v.loopBeats;
    }
  } catch (e) {
    // Note creation failed mid-loop — skip, retry next tick.
  }

  bgTimer = setTimeout(scheduleBg, SCHED_MS);
}

export function startBgTheme(variantId) {
  if (variantId && BG_VARIANTS[variantId]) currentVariantId = variantId;
  if (bgPlaying) return;
  bgPlaying = true;
  const c = getCtx();
  bgNextBeat = c ? c.currentTime + 0.12 : 0.12;
  bgBeatIdx  = 0;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(8, c.currentTime);
  lfo.frequency.linearRampToValueAtTime(14, c.currentTime + 0.65);
  const lfoG = c.createGain();
  lfoG.gain.value = 20;

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
  if (!c) return;
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

// Fast run → ta-ta-DAAAA! with bell shimmer and bass punch
export function playWin() {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const rev = makeReverb(c, 0.10, 0.38, 0.32);

  // Phase 1: rapid 8-note ascending run (C major, two octaves, triangle = bright)
  [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 987.77, 1046.5].forEach((freq, i) => {
    const ts = t + i * 0.065;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.24, ts);
    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.17);
    osc.connect(g); g.connect(out()); g.connect(rev);
    osc.start(ts); osc.stop(ts + 0.20);
  });

  // Phase 2: ta-ta-DAAAA rhythm — two short hits then the big chord
  [[0, [659.25, 783.99], false], [0.15, [659.25, 783.99], false], [0.32, [523.25, 659.25, 783.99, 1046.5], true]]
    .forEach(([delay, freqs, isFinal]) => {
      freqs.forEach(freq => {
        const ts = t + 0.50 + delay;
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = isFinal ? 4200 : 3000;
        const g = c.createGain();
        g.gain.setValueAtTime(isFinal ? 0.21 : 0.15, ts);
        g.gain.exponentialRampToValueAtTime(0.001, ts + (isFinal ? 2.1 : 0.14));
        osc.connect(filter); filter.connect(g);
        g.connect(out()); g.connect(rev);
        osc.start(ts); osc.stop(ts + (isFinal ? 2.2 : 0.18));
      });
    });

  // Phase 3: ascending bell shimmer on the big chord
  [1046.5, 1318.5, 1568, 2093, 2637].forEach((freq, i) => {
    const ts = t + 0.82 + i * 0.055;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.10, ts);
    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.95);
    osc.connect(g); g.connect(out()); g.connect(rev);
    osc.start(ts); osc.stop(ts + 1.0);
  });

  // Bass punch for impact on the big chord
  const bass = c.createOscillator();
  bass.type = 'sine';
  bass.frequency.setValueAtTime(130.81, t + 0.82);
  bass.frequency.exponentialRampToValueAtTime(52, t + 1.1);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.42, t + 0.82);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  bass.connect(bg); bg.connect(out()); bg.connect(rev);
  bass.start(t + 0.82); bass.stop(t + 1.45);
}

// Two notes that just… stop
export function playDraw() {
  const c = getCtx();
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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

// Big thump — same character as countdownBeat but deeper and heavier
export function playCountdownGo() {
  const c = getCtx();
  if (!c) return;
  const rev = makeReverb(c, 0.1, 0.3, 0.22);
  const t = c.currentTime;

  // Massive kick — starts lower, sweeps deeper, louder
  [100, 104].forEach(freq => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
    osc.connect(g); g.connect(out()); g.connect(rev);
    osc.start(t); osc.stop(t + 0.76);
  });

  // Harder attack transient
  const click = noise(c, 0.04);
  const cf = c.createBiquadFilter();
  cf.type = 'highpass'; cf.frequency.value = 1800;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.35, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  click.connect(cf); cf.connect(cg); cg.connect(out());
  click.start(t); click.stop(t + 0.05);

  // Sub-bass rumble sustain — same low register as the kick, fades slowly
  [65, 98, 130].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10 - i * 0.025, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    osc.connect(g); g.connect(out()); g.connect(rev);
    osc.start(t); osc.stop(t + 1.35);
  });
}

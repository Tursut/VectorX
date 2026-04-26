// All sounds generated via Web Audio API — no files needed.

let ctx = null;
let masterGain = null;

function createContext() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);
  // Any AudioBuffer cached from a previous (now-closed) context is bound to
  // that old context and won't decode + play on the new one. Force a
  // re-decode by dropping the cache. Without this, the bg theme silently
  // fails to play after the runtime closed our context (e.g. a long
  // backgrounded tab on Chrome desktop). Anyone observing this should NOT
  // see "no music" — they should see music re-init from the next gesture.
  bgBuffer = null;
  winBuffer = null;
  freezeBuffer = null;
  bombBuffer = null;
  portalJumpBuffer = null;
  eliminationBuffer = null;
  swapBuffer = null;
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

// Must be called from a user-gesture handler (touchstart / click) or from
// any of the page-visibility-style events. Recreates the context if closed,
// resumes a suspended one, and rebuilds the bg-source if iOS killed it
// while the page was backgrounded.
export function resumeAudio() {
  if (!ctx || ctx.state === 'closed') {
    const wasPlaying = bgPlaying;
    bgPlaying = false;
    bgSource = null;
    bgSourceEnded = false;
    createContext();
    if (wasPlaying) {
      ctx.resume().then(() => startBgTheme()).catch(() => {});
    } else {
      ctx.resume().catch(() => {});
    }
    return;
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  // ctx is up — but the bg-source under it might have been terminated by
  // iOS during a background period. If we expected music to be playing and
  // the source is missing or onended fired, rebuild it.
  if (bgPlaying && (bgSource === null || bgSourceEnded)) {
    bgLoadToken += 1;
    bgSourceEnded = false;
    startBgSource(bgLoadToken);
  }
}

// Global audio-recovery listeners — issue #17.
// iOS Safari (and Chrome iOS) suspends the AudioContext when the page is
// backgrounded and sometimes outright closes it after a longer absence.
// Touch / click cover the case where the user taps something on return,
// but if they just look at the screen the context stays dead. Hooking
// visibilitychange + focus + pageshow lets us resume the moment the page
// is brought back into view, without waiting for a tap.
//
// Registered at module load so the listeners persist across mounts of the
// game controllers and don't depend on React lifecycle.
if (typeof document !== 'undefined') {
  const onResumeIntent = () => resumeAudio();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') resumeAudio();
  };
  document.addEventListener('touchstart', onResumeIntent, { passive: true });
  document.addEventListener('touchend',   onResumeIntent, { passive: true });
  document.addEventListener('click',      onResumeIntent);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus',   onResumeIntent);
    window.addEventListener('pageshow', onResumeIntent);
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
// A single looping mp3 (public/bg-spring.mp3) plays under the whole game. We
// attach it to a dedicated gain node at 0.7 so bg music sits ~30% quieter
// than the effects that run through masterGain directly. No synth fallback;
// if the sample fails to load, the bg just stays silent.

const BG_VOLUME = 0.504; // bg music sits quiet under effects; tuned by ear.
const BG_FILE = `${import.meta.env.BASE_URL}bg-spring.mp3`;

let bgPlaying = false;
let bgSource = null;
let bgBuffer = null;
// Token prevents a late-arriving decode from starting playback for a request
// the user has since cancelled (stopBgTheme/quick-toggle).
let bgLoadToken = 0;
// True once iOS / the runtime has fired the current bgSource's `onended`
// event. Loop sources with `loop = true` shouldn't end on their own, so a
// fired onended means the runtime killed the source — typically because
// the page was backgrounded for too long. resumeAudio inspects this flag
// and rebuilds the source if needed.
let bgSourceEnded = false;

// Kicked off at module load so the 4 MB download happens in parallel with the
// rest of app init — by the time the user starts a game, this promise is
// usually already resolved. Decoded on first play (can't decode without an
// AudioContext, which only exists after a user gesture). index.html also
// carries a <link rel="preload" as="audio"> that starts the request even
// earlier, during HTML parsing; that + this both hit the HTTP cache so the
// second request is free.
let bgRawPromise = null;
function primeBgRaw() {
  if (bgRawPromise) return bgRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  bgRawPromise = fetch(BG_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return bgRawPromise;
}
primeBgRaw();

function stopBgSourceIfAny() {
  if (bgSource) {
    // Detach onended first so an explicit stop() doesn't spuriously
    // signal "iOS killed the source" (which would trigger recovery).
    bgSource.onended = null;
    try { bgSource.stop(); } catch { /* already stopped */ }
    try { bgSource.disconnect(); } catch { /* already disconnected */ }
    bgSource = null;
  }
  bgSourceEnded = false;
}

async function loadBgBuffer() {
  if (bgBuffer) return bgBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeBgRaw();
  if (!arr) throw new Error(`bg ${BG_FILE} failed to preload`);
  // decodeAudioData detaches the ArrayBuffer; the promise cache holds the
  // same buffer for reuse, so pass a clone on first decode. Subsequent calls
  // return the cached AudioBuffer before reaching this point.
  bgBuffer = await c.decodeAudioData(arr.slice(0));
  return bgBuffer;
}

async function startBgSource(token) {
  let buf;
  try { buf = await loadBgBuffer(); } catch { return; }
  if (!buf || !bgPlaying || token !== bgLoadToken) return;
  const c = getCtx();
  if (!c) return;
  // Make sure the context is actually running before we schedule playback.
  // getCtx() above kicks an unawaited resume() — on Chrome, resuming after
  // a long backgrounded period can silently no-op if it isn't awaited, and
  // then src.start() schedules audio that never plays. Await the resume so
  // we either have a running context or a clear failure.
  if (c.state === 'suspended') {
    try { await c.resume(); } catch (err) {
      console.warn('[sounds] bg theme resume failed', err);
      return;
    }
  }
  if (!bgPlaying || token !== bgLoadToken) return;
  stopBgSourceIfAny();
  const gain = c.createGain();
  gain.gain.value = BG_VOLUME;
  gain.connect(masterGain);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(gain);
  // onended only fires for a looping source if something killed it (iOS
  // background, runtime resource pressure, ctx close). Flagging this lets
  // resumeAudio detect a dead source and rebuild it on the next gesture.
  src.onended = () => {
    if (bgSource === src) bgSourceEnded = true;
  };
  bgSourceEnded = false;
  src.start(c.currentTime + 0.02);
  bgSource = src;
}

export function startBgTheme() {
  if (bgPlaying) return;
  bgPlaying = true;
  bgLoadToken += 1;
  startBgSource(bgLoadToken);
}

export function stopBgTheme() {
  bgPlaying = false;
  bgLoadToken += 1; // invalidate any in-flight decode
  stopBgSourceIfAny();
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

// Retro lose-jingle sample. Same one-shot AudioBufferSource + lazy
// fetch/decode pattern as the other samples. Fired by GameScreen 450 ms
// after a player flips to isEliminated, in the trap-animation timing
// chain (450 ms wind-up → trap animation → elimination sound → 2.5 s
// settle). Don't speed any of those up — beats are intentional per
// CLAUDE.md.
const ELIMINATION_FILE = `${import.meta.env.BASE_URL}elimination.mp3`;
const ELIMINATION_VOLUME = 0.85;
let eliminationRawPromise = null;
let eliminationBuffer = null;
function primeEliminationRaw() {
  if (eliminationRawPromise) return eliminationRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  eliminationRawPromise = fetch(ELIMINATION_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return eliminationRawPromise;
}
primeEliminationRaw();

async function loadEliminationBuffer() {
  if (eliminationBuffer) return eliminationBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeEliminationRaw();
  if (!arr) return null;
  eliminationBuffer = await c.decodeAudioData(arr.slice(0));
  return eliminationBuffer;
}

export async function playElimination() {
  let buf;
  try { buf = await loadEliminationBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = ELIMINATION_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
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

// Explosion sample. Same one-shot AudioBufferSource + lazy fetch/decode
// pattern as playWin / playFreeze. Bomb is unique among items in that
// pickup IS the apply step (no target-selection between), so the
// existing useDerivedAnimations call site at the pickup transition is
// the right moment to fire this — no relocation needed.
const BOMB_FILE = `${import.meta.env.BASE_URL}bomb-explosion.mp3`;
const BOMB_VOLUME = 0.85;
let bombRawPromise = null;
let bombBuffer = null;
function primeBombRaw() {
  if (bombRawPromise) return bombRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  bombRawPromise = fetch(BOMB_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return bombRawPromise;
}
primeBombRaw();

async function loadBombBuffer() {
  if (bombBuffer) return bombBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeBombRaw();
  if (!arr) return null;
  bombBuffer = await c.decodeAudioData(arr.slice(0));
  return bombBuffer;
}

export async function playBomb() {
  let buf;
  try { buf = await loadBombBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = BOMB_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
}

// Crystalline ascending arpeggio with icy LFO shimmer
// Iced-magic sample. Mirrors the win-fanfare load pattern (one-shot
// AudioBufferSource, lazy fetch + decode, cache invalidated on context
// recreate). Played when a freeze gets APPLIED to a target — pickup is
// silent for freeze (the freezeSelectActive cell-targeting overlay is
// the visual cue that the user is in freeze-pick mode).
const FREEZE_FILE = `${import.meta.env.BASE_URL}freeze-apply.mp3`;
const FREEZE_VOLUME = 0.85;
let freezeRawPromise = null;
let freezeBuffer = null;
function primeFreezeRaw() {
  if (freezeRawPromise) return freezeRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  freezeRawPromise = fetch(FREEZE_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return freezeRawPromise;
}
primeFreezeRaw();

async function loadFreezeBuffer() {
  if (freezeBuffer) return freezeBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeFreezeRaw();
  if (!arr) return null;
  freezeBuffer = await c.decodeAudioData(arr.slice(0));
  return freezeBuffer;
}

export async function playFreeze() {
  let buf;
  try { buf = await loadFreezeBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = FREEZE_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
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

// Brass fanfare with reverberated tail. One-shot mp3 sample; mirrors the
// bg-theme fetch/decode pattern but plays a single non-looping
// AudioBufferSourceNode each call. Falls back silent on fetch/decode
// failure (matches bg's "if the sample fails to load, just stay quiet").
const WIN_FILE = `${import.meta.env.BASE_URL}win-fanfare.mp3`;
const WIN_VOLUME = 0.85; // sample is already mastered; play near full out().
let winRawPromise = null;
let winBuffer = null;
function primeWinRaw() {
  if (winRawPromise) return winRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  winRawPromise = fetch(WIN_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return winRawPromise;
}
primeWinRaw();

async function loadWinBuffer() {
  if (winBuffer) return winBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeWinRaw();
  if (!arr) return null;
  // decodeAudioData detaches the ArrayBuffer; clone on first decode so the
  // promise cache can survive a context-recreate (which clears winBuffer
  // via createContext) without losing the source bytes.
  winBuffer = await c.decodeAudioData(arr.slice(0));
  return winBuffer;
}

export async function playWin() {
  let buf;
  try { buf = await loadWinBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = WIN_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
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

// Portal-jump sample. Same one-shot AudioBufferSource + lazy
// fetch/decode pattern as the other samples. Fires when the user picks
// the destination cell in portal mode (the "use the portal" moment),
// not when they pick up the portal item — that pickup cue stays as the
// existing synthesized playPortal so the freeze-mode and portal-mode
// pickups remain audibly distinct.
const PORTAL_JUMP_FILE = `${import.meta.env.BASE_URL}portal-jump.mp3`;
const PORTAL_JUMP_VOLUME = 0.85;
let portalJumpRawPromise = null;
let portalJumpBuffer = null;
function primePortalJumpRaw() {
  if (portalJumpRawPromise) return portalJumpRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  portalJumpRawPromise = fetch(PORTAL_JUMP_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return portalJumpRawPromise;
}
primePortalJumpRaw();

async function loadPortalJumpBuffer() {
  if (portalJumpBuffer) return portalJumpBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primePortalJumpRaw();
  if (!arr) return null;
  portalJumpBuffer = await c.decodeAudioData(arr.slice(0));
  return portalJumpBuffer;
}

export async function playPortalJump() {
  let buf;
  try { buf = await loadPortalJumpBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = PORTAL_JUMP_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
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

// Cinematic-travel sample. Same one-shot AudioBufferSource + lazy
// fetch/decode pattern as the other replacements. Fires when a swap
// gets APPLIED — the user picked the partner cell and the two players
// have just changed places. Matches the freeze flow: pickup is the
// existing playSwapActivate cue (kept synth), apply is this sample.
const SWAP_FILE = `${import.meta.env.BASE_URL}swap-apply.mp3`;
const SWAP_VOLUME = 0.85;
let swapRawPromise = null;
let swapBuffer = null;
function primeSwapRaw() {
  if (swapRawPromise) return swapRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  swapRawPromise = fetch(SWAP_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return swapRawPromise;
}
primeSwapRaw();

async function loadSwapBuffer() {
  if (swapBuffer) return swapBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeSwapRaw();
  if (!arr) return null;
  swapBuffer = await c.decodeAudioData(arr.slice(0));
  return swapBuffer;
}

export async function playSwap() {
  let buf;
  try { buf = await loadSwapBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = SWAP_VOLUME;
  gain.connect(out());
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(c.currentTime + 0.02);
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

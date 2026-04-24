// All sounds generated via Web Audio API — no files needed.

let ctx = null;
let masterGain = null;

function createContext() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);
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
// then resumes and restarts bg music if it was playing.
export function resumeAudio() {
  if (!ctx || ctx.state === 'closed') {
    const wasPlaying = bgPlaying;
    bgPlaying = false;
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

const BG_VOLUME = 0.7;
const BG_FILE = `${import.meta.env.BASE_URL}bg-spring.mp3`;

let bgPlaying = false;
let bgSource = null;
let bgBuffer = null;
// Token prevents a late-arriving decode from starting playback for a request
// the user has since cancelled (stopBgTheme/quick-toggle).
let bgLoadToken = 0;

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
    try { bgSource.stop(); } catch { /* already stopped */ }
    try { bgSource.disconnect(); } catch { /* already disconnected */ }
    bgSource = null;
  }
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
  stopBgSourceIfAny();
  const gain = c.createGain();
  gain.gain.value = BG_VOLUME;
  gain.connect(masterGain);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(gain);
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

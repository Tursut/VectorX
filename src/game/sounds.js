// All sounds generated via Web Audio API — no files needed.

let ctx = null;
let masterGain = null;
const AUDIO_DEBUG_STORAGE_KEY = 'audioDebugLogV1';
const AUDIO_DEBUG_LIMIT = 20;
const audioDebugEvents = [];
const audioDebugListeners = new Set();
let contextCreatedAt = null;

function nowIso() {
  return new Date().toISOString();
}

function loadPersistedDebugEvents() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(AUDIO_DEBUG_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.slice(-AUDIO_DEBUG_LIMIT).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      audioDebugEvents.push({
        at: typeof entry.at === 'string' ? entry.at : nowIso(),
        type: typeof entry.type === 'string' ? entry.type : 'unknown',
        detail: entry.detail && typeof entry.detail === 'object' ? entry.detail : {},
      });
    });
  } catch {
    // Ignore malformed persisted debug logs.
  }
}

function persistDebugEvents() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUDIO_DEBUG_STORAGE_KEY, JSON.stringify(audioDebugEvents));
  } catch {
    // Ignore private-mode/quota errors. Debug logs are best effort.
  }
}

function pushAudioDebug(type, detail = {}) {
  audioDebugEvents.push({ at: nowIso(), type, detail });
  if (audioDebugEvents.length > AUDIO_DEBUG_LIMIT) {
    audioDebugEvents.splice(0, audioDebugEvents.length - AUDIO_DEBUG_LIMIT);
  }
  persistDebugEvents();
  audioDebugListeners.forEach((listener) => listener());
}

loadPersistedDebugEvents();

export function subscribeAudioDebug(listener) {
  if (typeof listener !== 'function') return () => {};
  audioDebugListeners.add(listener);
  return () => audioDebugListeners.delete(listener);
}

export function getAudioDebugSnapshot() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return {
    contextState: ctx?.state ?? 'missing',
    currentTime: ctx ? Number(ctx.currentTime.toFixed(3)) : null,
    contextAgeMs: contextCreatedAt ? Date.now() - contextCreatedAt : null,
    masterGain: masterGain ? Number(masterGain.gain.value.toFixed(3)) : null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    userAgent: nav?.userAgent ?? null,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
    audioSessionType: nav?.audioSession?.type ?? null,
    events: audioDebugEvents.slice(-8),
  };
}

export function logAudioDebugEvent(type, detail = {}) {
  pushAudioDebug(type, detail);
}

function createContext() {
  // Bail silently in environments without WebAudio (jsdom test runner,
  // legacy browsers). Without this guard the page-load resume listeners
  // below would throw uncaught exceptions on every click in jsdom and
  // fail the test runner even though no test depends on audio.
  const Ctor = typeof window !== 'undefined'
    && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return;
  ctx = new Ctor();
  contextCreatedAt = Date.now();
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);
  pushAudioDebug('context-created', { state: ctx.state });
  // Any AudioBuffer cached from a previous (now-closed) context is bound to
  // that old context and won't decode + play on the new one. Force a
  // re-decode by dropping the cache. Without this, the bg theme silently
  // fails to play after the runtime closed our context (e.g. a long
  // backgrounded tab on Chrome desktop). Anyone observing this should NOT
  // see "no music" — they should see music re-init from the next gesture.
  bgTrack.dropCache();
  menuTrack.dropCache();
  winBuffer = null;
  freezeBuffer = null;
  bombBuffer = null;
  portalJumpBuffer = null;
  eliminationBuffer = null;
  swapBuffer = null;
  clickBuffer = null;
}

// Never auto-recreates a closed context — that must happen from a user gesture in resumeAudio().
// Returning null lets callers fail silently rather than create a tainted context.
function getCtx() {
  if (!ctx || ctx.state === 'closed') return null;
  if (ctx.state === 'suspended') {
    pushAudioDebug('ctx-suspended-observed');
    ctx.resume().then(() => {
      pushAudioDebug('ctx-resume-ok', { from: 'getCtx', state: ctx?.state ?? 'missing' });
    }).catch((err) => {
      pushAudioDebug('ctx-resume-failed', {
        from: 'getCtx',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return ctx;
}

function out() {
  return masterGain;
}

export function setMuted(val) {
  if (masterGain) masterGain.gain.value = val ? 0 : 1;
  pushAudioDebug('mute-changed', { muted: !!val, gain: masterGain?.gain?.value ?? null });
}

// Must be called from a user-gesture handler (touchstart / click) or from
// any of the page-visibility-style events. Recreates the context if closed,
// resumes a suspended one, and rebuilds the bg-source if iOS killed it
// while the page was backgrounded.
export function resumeAudio() {
  pushAudioDebug('resume-called', { state: ctx?.state ?? 'missing' });
  if (!ctx || ctx.state === 'closed') {
    // Snapshot which themes were playing BEFORE we drop the context, so
    // we can restart whichever the user was hearing once the new context
    // is up.
    const bgWas = bgTrack.resetForNewContext();
    const menuWas = menuTrack.resetForNewContext();
    createContext();
    if (!ctx) {
      pushAudioDebug('resume-no-context');
      return; // No WebAudio support — silent no-op.
    }
    if (bgWas || menuWas) {
      ctx.resume().then(() => {
        pushAudioDebug('resume-ok-recreated', { bgWas, menuWas });
        if (bgWas) bgTrack.start();
        else if (menuWas) menuTrack.start();
      }).catch((err) => {
        pushAudioDebug('resume-failed-recreated', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      ctx.resume().then(() => {
        pushAudioDebug('resume-ok-empty');
      }).catch((err) => {
        pushAudioDebug('resume-failed-empty', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return;
  }
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      pushAudioDebug('resume-ok-suspended');
    }).catch((err) => {
      pushAudioDebug('resume-failed-suspended', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
  // ctx is up — but a track's source might have been terminated by iOS
  // during a background period. recoverIfNeeded rebuilds either source
  // if it expected to be playing.
  bgTrack.recoverIfNeeded();
  menuTrack.recoverIfNeeded();
  pushAudioDebug('resume-recover-checked');
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
  const onResumeIntent = (source) => {
    pushAudioDebug('resume-intent', { source });
    resumeAudio();
  };
  const onVisibilityChange = () => {
    pushAudioDebug('visibilitychange', { state: document.visibilityState });
    if (document.visibilityState === 'visible') onResumeIntent('visibility-visible');
  };
  document.addEventListener('touchstart', () => onResumeIntent('touchstart'), { passive: true });
  document.addEventListener('touchend', () => onResumeIntent('touchend'), { passive: true });
  document.addEventListener('click', () => onResumeIntent('click'));
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => onResumeIntent('focus'));
    window.addEventListener('pageshow', (event) => {
      pushAudioDebug('pageshow', { persisted: !!event?.persisted });
      onResumeIntent('pageshow');
    });
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

// ── Background themes ────────────────────────────────────────────────────────
// Two looping mp3s share the same plumbing via a `makeBgTrack` factory:
//
//   - bg-spring.mp3      — under the active game (phase === 'playing')
//   - starostin… .mp3    — under the start screen / lobby / leaderboard
//
// Both use a dedicated gain node so they sit ~30–60% quieter than the
// effects that run through masterGain directly. The two are mutually
// exclusive — useGameplaySounds picks whichever matches the current
// phase, and mid-flight start/stop calls invalidate any pending decode
// via a load token so a late-arriving sample can't sneak in after a
// quick toggle.

const BG_VOLUME = 0.504;       // bg music sits quiet under in-game effects.
const BG_FILE = `${import.meta.env.BASE_URL}bg-spring.mp3`;
// Web-audio gain isn't perceptually linear — 0.25 still sounded too loud
// in playtest. Dropping to 0.15: clearly a soft bed under foreground
// sounds. Iterate down further if still too present.
const MENU_VOLUME = 0.15;
const MENU_FILE = `${import.meta.env.BASE_URL}bg-menu.mp3`;
// Default fade-out length when stopping a track (issue: menu used to cut
// abruptly the moment the countdown started). Used by both tracks.
const TRACK_FADE_OUT_MS = 500;

function makeBgTrack(file, volume) {
  let playing = false;
  let source = null;
  // Per-source gain node, kept around so stop() can ramp it to 0 for a
  // fade-out before disconnecting.
  let sourceGain = null;
  let buffer = null;
  // Token prevents a late-arriving decode from starting playback for a
  // request the user has since cancelled (stop / quick-toggle).
  let loadToken = 0;
  // True once the runtime has fired the current source's `onended`. A
  // looping source shouldn't end on its own, so a fired onended means the
  // runtime killed it — typically iOS killing audio on a long backgrounded
  // page. resumeAudio uses this to detect a dead source and rebuild it.
  let sourceEnded = false;

  // Kicked off at module load so the download happens in parallel with the
  // rest of app init. Decoded on first play (can't decode without an
  // AudioContext, which only exists after a user gesture).
  let rawPromise = null;
  function primeRaw() {
    if (rawPromise) return rawPromise;
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    rawPromise = fetch(file)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .catch(() => null);
    return rawPromise;
  }

  function stopSourceIfAny() {
    if (source) {
      // Detach onended so an explicit stop() doesn't spuriously signal
      // "iOS killed the source" (which would trigger recovery).
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
      source = null;
    }
    if (sourceGain) {
      try { sourceGain.disconnect(); } catch { /* already disconnected */ }
      sourceGain = null;
    }
    sourceEnded = false;
  }

  async function loadBuffer() {
    if (buffer) return buffer;
    const c = getCtx();
    if (!c) return null;
    const arr = await primeRaw();
    if (!arr) throw new Error(`bg ${file} failed to preload`);
    // decodeAudioData detaches the ArrayBuffer; the promise cache holds the
    // same buffer for reuse, so pass a clone on first decode.
    buffer = await c.decodeAudioData(arr.slice(0));
    return buffer;
  }

  async function startSource(token) {
    let buf;
    try { buf = await loadBuffer(); } catch { return; }
    if (!buf || !playing || token !== loadToken) return;
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      try { await c.resume(); } catch (err) {
        console.warn(`[sounds] ${file} resume failed`, err);
        pushAudioDebug('track-start-resume-failed', {
          file,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
    if (!playing || token !== loadToken) return;
    stopSourceIfAny();
    const gain = c.createGain();
    gain.gain.value = volume;
    gain.connect(masterGain);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.onended = () => {
      if (source === src) sourceEnded = true;
      pushAudioDebug('track-source-ended', { file });
    };
    sourceEnded = false;
    src.start(c.currentTime + 0.02);
    source = src;
    sourceGain = gain;
    pushAudioDebug('track-source-started', { file, token });
  }

  function start() {
    if (playing) return;
    playing = true;
    loadToken += 1;
    pushAudioDebug('track-start-requested', { file, token: loadToken });
    startSource(loadToken);
  }

  function stop({ fadeMs = TRACK_FADE_OUT_MS } = {}) {
    playing = false;
    loadToken += 1; // invalidate any in-flight decode
    pushAudioDebug('track-stop-requested', { file, fadeMs });
    const c = getCtx();
    if (fadeMs <= 0 || !source || !sourceGain || !c) {
      stopSourceIfAny();
      return;
    }
    // Take ownership of the current source/gain refs locally so a
    // concurrent start() (which would call stopSourceIfAny()) doesn't
    // race the fade and leave a half-faded source dangling.
    const fadeSrc = source;
    const fadeGain = sourceGain;
    source = null;
    sourceGain = null;
    sourceEnded = false;
    const now = c.currentTime;
    try {
      fadeGain.gain.cancelScheduledValues(now);
      fadeGain.gain.setValueAtTime(fadeGain.gain.value, now);
      fadeGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    } catch { /* fall through to immediate stop */ }
    setTimeout(() => {
      fadeSrc.onended = null;
      try { fadeSrc.stop(); } catch { /* already stopped */ }
      try { fadeSrc.disconnect(); } catch { /* already disconnected */ }
      try { fadeGain.disconnect(); } catch { /* already disconnected */ }
    }, fadeMs);
  }

  function recoverIfNeeded() {
    if (playing && (source === null || sourceEnded)) {
      loadToken += 1;
      sourceEnded = false;
      pushAudioDebug('track-recovering', { file, token: loadToken });
      startSource(loadToken);
    } else {
      pushAudioDebug('track-recover-skip', {
        file,
        playing,
        hasSource: source !== null,
        sourceEnded,
      });
    }
  }

  // Called when the AudioContext closes (iOS background reclaim). Forget
  // the source reference but report whether we WERE playing so resumeAudio
  // can restart us once a new context is created.
  function resetForNewContext() {
    const was = playing;
    playing = false;
    source = null;
    sourceEnded = false;
    pushAudioDebug('track-reset-for-new-context', { file, wasPlaying: was });
    return was;
  }

  // The decoded buffer is bound to the current AudioContext. When that
  // context closes, drop the cache so the next play decodes against the
  // new context.
  function dropCache() { buffer = null; }

  // Kick off the prefetch at module load. Both tracks race the same HTTP
  // cache that index.html's `<link rel="preload">` warmed up.
  primeRaw();

  return { start, stop, recoverIfNeeded, resetForNewContext, dropCache };
}

const bgTrack = makeBgTrack(BG_FILE, BG_VOLUME);
const menuTrack = makeBgTrack(MENU_FILE, MENU_VOLUME);

export const startBgTheme = bgTrack.start;
export const stopBgTheme = bgTrack.stop;
export const startMenuTheme = menuTrack.start;
export const stopMenuTheme = menuTrack.stop;

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
const ELIMINATION_VOLUME = 0.6375;
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
const BOMB_VOLUME = 0.6375;
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

// Universal pen-click sample. Fired from every mainline button onClick
// in StartScreen, Lobby, and the exit-confirm modal. Volume sits well
// below the gameplay samples since this fires constantly and shouldn't
// overpower bg music or move/claim audio. Same one-shot
// AudioBufferSource + lazy fetch/decode/cache pattern as the rest.
const CLICK_FILE = `${import.meta.env.BASE_URL}click.mp3`;
const CLICK_VOLUME = 0.375;
let clickRawPromise = null;
let clickBuffer = null;
function primeClickRaw() {
  if (clickRawPromise) return clickRawPromise;
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  clickRawPromise = fetch(CLICK_FILE)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  return clickRawPromise;
}
primeClickRaw();

async function loadClickBuffer() {
  if (clickBuffer) return clickBuffer;
  const c = getCtx();
  if (!c) return null;
  const arr = await primeClickRaw();
  if (!arr) return null;
  clickBuffer = await c.decodeAudioData(arr.slice(0));
  return clickBuffer;
}

export async function playClick() {
  let buf;
  try { buf = await loadClickBuffer(); } catch { return; }
  if (!buf) return;
  const c = getCtx();
  if (!c) return;
  const gain = c.createGain();
  gain.gain.value = CLICK_VOLUME;
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
const FREEZE_VOLUME = 0.6375;
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
const WIN_VOLUME = 0.6375; // sample is already mastered; -25 % from full out().
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
const PORTAL_JUMP_VOLUME = 0.6375;
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
const SWAP_VOLUME = 0.6375;
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

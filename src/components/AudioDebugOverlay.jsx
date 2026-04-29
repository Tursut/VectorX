import { useEffect, useState } from 'react';
import { getAudioDebugSnapshot, subscribeAudioDebug } from '../game/sounds';

export default function AudioDebugOverlay({ enabled = false }) {
  const [snapshot, setSnapshot] = useState(() => getAudioDebugSnapshot());
  const [copyState, setCopyState] = useState('idle');

  useEffect(() => {
    if (!enabled) return undefined;
    const update = () => setSnapshot(getAudioDebugSnapshot());
    update();
    const unsubscribe = subscribeAudioDebug(update);
    const t = setInterval(update, 1000);
    return () => {
      unsubscribe();
      clearInterval(t);
    };
  }, [enabled]);

  if (!enabled) return null;

  async function handleCopy() {
    const payload = JSON.stringify(getAudioDebugSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 1200);
    }
  }

  return (
    <div className="audio-debug-overlay" aria-live="polite">
      <div className="audio-debug-header">
        <strong>AUDIO DEBUG</strong>
        <button type="button" className="audio-debug-copy" onClick={handleCopy}>
          {copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'COPY FAILED' : 'COPY'}
        </button>
      </div>
      <pre className="audio-debug-body">
{`state:        ${snapshot.contextState}
currentTime:  ${snapshot.currentTime ?? '(none)'}
ctxAgeMs:     ${snapshot.contextAgeMs ?? '(none)'}
masterGain:   ${snapshot.masterGain ?? '(none)'}
visibility:   ${snapshot.visibility ?? '(none)'}
viewport:     ${snapshot.viewport ?? '(none)'}
audioSession: ${snapshot.audioSessionType ?? '(none)'}
events:
${snapshot.events.length ? snapshot.events.map((e) => `  ${e.at.slice(11, 23)} ${e.type}`).join('\n') : '  (empty)'}`}
      </pre>
    </div>
  );
}

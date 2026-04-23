// JoinScreen — pure presentational form for joining an existing room.
// Step 15. No network code; the parent (Step 16's OnlineGameController)
// turns `{code, displayName}` into a WebSocket URL and invokes the
// useNetworkGame `join()` sender.
//
// Two inputs: displayName (validated against server's DisplayName schema —
// 1..20 chars, no leading/trailing whitespace) and code (5-char base32
// alphabet from src/game/constants-derived wire protocol). Code input
// uppercases as you type, strips characters outside the alphabet, and
// auto-extracts the code from a pasted share link.

import { useEffect, useRef, useState } from 'react';

const CODE_ALPHABET_RE = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g;
const CODE_TOKEN_RE = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/;

function filterCode(raw) {
  // Uppercase, drop anything outside the alphabet, clamp to 5 chars.
  return (raw.toUpperCase().match(CODE_ALPHABET_RE) ?? []).join('').slice(0, 5);
}

function extractCodeFromPaste(text) {
  const upper = text.toUpperCase();
  // Prefer share-link shape (/r/ABCDE) — avoids matching earlier 5-char
  // alphabet runs that happen to appear in URL schemes etc. (e.g. "HTTPS").
  const linkHit = upper.match(/\/R\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5})/);
  if (linkHit) return linkHit[1];
  const tokenHit = upper.match(CODE_TOKEN_RE);
  return tokenHit ? tokenHit[0] : null;
}

function isDisplayNameValid(raw) {
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 20;
}

function isCodeValid(code) {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code);
}

export default function JoinScreen({ defaultCode = '', onSubmit, onCancel }) {
  const [code, setCode] = useState(filterCode(defaultCode));
  const [displayName, setDisplayName] = useState('');
  const codeInputRef = useRef(null);
  const nameInputRef = useRef(null);

  // Autofocus: if a code was pre-filled (share link), focus the name field;
  // otherwise focus the code field so the user can type or paste.
  useEffect(() => {
    if (defaultCode && isCodeValid(filterCode(defaultCode))) {
      nameInputRef.current?.focus();
    } else {
      codeInputRef.current?.focus();
    }
  }, [defaultCode]);

  const canSubmit = isCodeValid(code) && isDisplayNameValid(displayName);

  function handleCodeChange(e) {
    setCode(filterCode(e.target.value));
  }

  function handleCodePaste(e) {
    const pasted = e.clipboardData?.getData('text');
    if (!pasted) return;
    const token = extractCodeFromPaste(pasted);
    if (token) {
      e.preventDefault();
      setCode(token);
    }
    // Else fall through; the onChange will still filter.
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({ code, displayName: displayName.trim() });
  }

  return (
    <form className="join-screen" onSubmit={handleSubmit}>
      <h2>Join a room</h2>

      <label className="join-field">
        <span>Your name</span>
        <input
          ref={nameInputRef}
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Alice"
          maxLength={20}
          autoComplete="off"
        />
      </label>

      <label className="join-field">
        <span>Room code</span>
        <input
          ref={codeInputRef}
          type="text"
          value={code}
          onChange={handleCodeChange}
          onPaste={handleCodePaste}
          placeholder="ABCDE"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          maxLength={5}
          aria-label="Room code"
        />
      </label>

      <div className="join-actions">
        <button type="submit" disabled={!canSubmit}>Join</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}

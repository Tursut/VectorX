import { useState } from 'react';

const MAX_PLAYERS = 4;

function buildShareLink(code) {
  if (typeof window === 'undefined' || !window.location) return `#/r/${code}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/r/${code}`;
}

export default function Lobby({
  code,
  players = [],
  hostId,
  mySeatId,
  onStart,
  onLeave,
}) {
  const isHost = mySeatId !== null && mySeatId !== undefined && mySeatId === hostId;
  const emptySeats = Math.max(0, MAX_PLAYERS - players.length);
  const shareLink = buildShareLink(code);
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <section className="lobby" aria-label="Waiting room">
      <header className="lobby-header">
        <h2>Room <span className="lobby-code">{code}</span></h2>
        <div className="lobby-share">
          <span className="lobby-share-link">
            Share to invite friends: <a href={shareLink}>{shareLink}</a>
          </span>
          <button
            type="button"
            className={`lobby-copy-btn${copied ? ' lobby-copy-btn-done' : ''}`}
            onClick={copyLink}
            aria-label="Copy invite link"
          >
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
        </div>
      </header>

      <ul className="lobby-players" aria-label="Players">
        {players.map((p) => (
          <li key={p.id} className="lobby-player">
            <span className="lobby-player-name">{p.displayName}</span>
            {p.id === hostId && <span className="lobby-badge-host" aria-label="host"> 👑</span>}
            {p.id === mySeatId && <span className="lobby-badge-you"> (you)</span>}
          </li>
        ))}
        {Array.from({ length: emptySeats }, (_, i) => (
          <li key={`empty-${i}`} className="lobby-player lobby-empty-seat">
            🤖 Bot will fill this slot
          </li>
        ))}
      </ul>

      {isHost && (
        <div className="lobby-host-controls">
          <button
            type="button"
            className="lobby-start-btn"
            onClick={() => onStart?.()}
          >
            Start game
          </button>
        </div>
      )}

      {!isHost && (
        <p className="lobby-wait-note">Waiting for the host to start…</p>
      )}

      {onLeave && (
        <button type="button" className="lobby-leave-btn" onClick={onLeave}>
          ← Exit to menu
        </button>
      )}
    </section>
  );
}

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

      <div className="lobby-hero">
        <h1 className="lobby-title">LOBBY</h1>
        <p className="lobby-room-line">
          Room <span className="lobby-code">{code}</span>
        </p>
      </div>

      <div className="lobby-invite">
        <span className="lobby-invite-label">Invite friends</span>
        <a className="lobby-invite-url" href={shareLink}>{shareLink}</a>
        <button
          type="button"
          className={`lobby-copy-btn${copied ? ' lobby-copy-btn-done' : ''}`}
          onClick={copyLink}
          aria-label="Copy invite link"
        >
          {copied ? '✓ Copied!' : '📋 Copy link'}
        </button>
      </div>

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
        <p className="lobby-host-note">
          Start now — empty slots will be filled by bots.
        </p>
      )}

      {!isHost && (
        <p className="lobby-wait-note">Waiting for the host to start…</p>
      )}

      {onLeave && (
        <button type="button" className="lobby-leave-btn" onClick={onLeave}>
          ← Exit to menu
        </button>
      )}

      {/* Sticky primary action — same visual + behaviour as StartScreen's
          "START THE GAME →" so the host's flow feels continuous: tap orange
          gradient button at the bottom of the start screen → land in the
          lobby → tap the same orange gradient button at the bottom to play. */}
      {isHost && (
        <div className="start-button-bar">
          <button
            type="button"
            className="start-button"
            onClick={() => onStart?.()}
          >
            START GAME →
          </button>
        </div>
      )}
    </section>
  );
}

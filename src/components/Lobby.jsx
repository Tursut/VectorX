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
    <div className="lobby-wrap">
      <section className="lobby" aria-label="Waiting room">

        <div className="lobby-hero">
          <h1 className="lobby-title">LOBBY</h1>
        </div>

        <div className="lobby-invite">
          <p className="lobby-invite-code" aria-label={`Room code ${code}`}>{code}</p>
          <div className="lobby-invite-row">
            <a className="lobby-invite-url" href={shareLink}>{shareLink}</a>
            <button
              type="button"
              className={`lobby-copy-btn${copied ? ' lobby-copy-btn-done' : ''}`}
              onClick={copyLink}
              aria-label={copied ? 'Invite link copied' : 'Copy invite link'}
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
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

        {!isHost && (
          <p className="lobby-wait-note">Waiting for the host to start…</p>
        )}
      </section>

      {/* Exit-to-menu button sits OUTSIDE the lobby card so it visually
          matches the GameScreen's exit-game-btn (same class, same styling,
          same on-page-bg position) — issue #19. */}
      {onLeave && (
        <button type="button" className="exit-game-btn" onClick={onLeave}>
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
    </div>
  );
}

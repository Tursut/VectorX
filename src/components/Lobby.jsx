import { useState } from 'react';
import { playClick } from '../game/sounds';

const MAX_PLAYERS = 4;

function buildShareLink(code) {
  if (typeof window === 'undefined' || !window.location) return `#/r/${code}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/r/${code}`;
}

// Display form of the share link. The host says/shares the code (HB2UM) — the
// URL is just for tap-to-join, so we drop the protocol to keep it on one line
// at typical phone widths.
function displayShareLink(href) {
  return href.replace(/^https?:\/\//, '');
}

// iOS-style share glyph (box with up-arrow) — the universally
// recognised "share" affordance on mobile. Inline SVG so it inherits
// currentColor and avoids an asset round-trip.
function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
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
    playClick();
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  async function shareOrCopy() {
    playClick();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Mind the Grid',
          text: 'Join my game!',
          url: shareLink,
        });
        return;
      } catch {
        // User cancelled the share sheet, or the platform refused — fall
        // through to clipboard so the action still has SOME effect.
      }
    }
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  // Plain tap on the URL copies — power-user shortcut so people don't have
  // to aim for the small icon button. Modifier-clicks (cmd/ctrl/middle/shift)
  // keep the native "open in new tab" behaviour.
  function handleUrlClick(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    copyLink();
  }

  return (
    <div className="lobby-wrap">
      <section className="lobby" aria-label="Waiting room">

        <div className="lobby-hero">
          <h1 className="lobby-title">LOBBY</h1>
        </div>

        <div className="lobby-invite">
          <p
            className="lobby-invite-code"
            data-testid="lobby-code"
            aria-label={`Room code ${code}`}
          >
            {code}
          </p>
          <div className="lobby-invite-row">
            <a
              className="lobby-invite-url"
              href={shareLink}
              onClick={handleUrlClick}
            >
              {displayShareLink(shareLink)}
            </a>
            <button
              type="button"
              className={`lobby-copy-btn${copied ? ' lobby-copy-btn-done' : ''}`}
              onClick={shareOrCopy}
              aria-label={copied ? 'Invite link copied' : 'Share invite link'}
            >
              {copied ? '✓' : <ShareIcon />}
            </button>
          </div>
          <p
            className={`lobby-copy-feedback${copied ? ' lobby-copy-feedback-shown' : ''}`}
            role="status"
            aria-live="polite"
          >
            {copied ? '✓ Link copied!' : ''}
          </p>
        </div>

        <div className="lobby-explainer">
          <h2 className="lobby-explainer-title">GATHER YOUR CREW</h2>
          <p className="lobby-explainer-body">
            Share the link or code with friends. When everyone&apos;s in,
            hit start — any empty seats get filled with bots.
          </p>
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
            <li
              key={`empty-${i}`}
              className="lobby-player lobby-empty-seat"
              data-testid="lobby-empty-seat"
            >
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
        <button
          type="button"
          className="exit-game-btn"
          onClick={() => { playClick(); onLeave(); }}
        >
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
            onClick={() => { playClick(); onStart?.(); }}
          >
            START GAME →
          </button>
        </div>
      )}
    </div>
  );
}

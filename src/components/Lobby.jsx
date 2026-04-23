// Lobby — pure presentational waiting-room. Step 15.
//
// Renders the room code (with a shareable link), the current roster,
// empty-seat placeholders that will be filled by bots at START, and — for
// the host only — a magic-items toggle and a Start button.
//
// No network code. The parent (Step 16's OnlineGameController) feeds props
// from useNetworkGame.lobby and wires callbacks to `start(magicItems)` etc.

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

  return (
    <section className="lobby" aria-label="Waiting room">
      <header className="lobby-header">
        <h2>Room <span className="lobby-code">{code}</span></h2>
        <p className="lobby-share">
          Share this link to invite friends: <a href={shareLink}>{shareLink}</a>
        </p>
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

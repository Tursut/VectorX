export default function TurnIndicator({ player, taunt, timeLeft, totalTime, bonusMoveActive, portalActive }) {
  const pct = (timeLeft / totalTime) * 100;
  const urgent = timeLeft <= 3;

  let statusLine = taunt;
  if (portalActive) statusLine = '🌀 PORTAL active! Pick any empty square on the board.';
  else if (bonusMoveActive) statusLine = '🚀 BOOST! Take one extra step. Make it hurt.';

  return (
    <div className={`turn-indicator ${urgent ? 'turn-indicator-urgent' : ''}`} style={{ borderColor: player.color }}>
      <div className="turn-icon" style={{ backgroundColor: player.color }}>
        {player.icon}
      </div>
      <div className="turn-text">
        <div className="turn-name" style={{ color: player.color }}>
          {player.name}
        </div>
        <div className={`turn-taunt ${portalActive || bonusMoveActive ? 'turn-taunt-special' : ''}`}>
          {statusLine}
        </div>
        <div className="turn-timer">
          <span className="turn-watch">⌚</span>
          <div className="timer-bar">
            <div
              className="timer-fill"
              style={{
                width: `${pct}%`,
                backgroundColor: urgent ? '#e74c3c' : player.color,
              }}
            />
          </div>
          <span className={`timer-count ${urgent ? 'timer-count-urgent' : ''}`}>
            {timeLeft}
          </span>
        </div>
      </div>
    </div>
  );
}

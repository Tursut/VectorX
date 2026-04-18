import { AnimatePresence, motion } from 'framer-motion';

export default function TurnIndicator({ player, taunt, timeLeft, totalTime, bonusMoveActive, portalActive }) {
  const pct = (timeLeft / totalTime) * 100;
  const urgent = timeLeft <= 3;

  let statusLine = taunt;
  if (portalActive) statusLine = '🌀 PORTAL active! Pick any empty square on the board.';
  else if (bonusMoveActive) statusLine = '🚀 BOOST! Take one extra step. Make it hurt.';

  // Key changes on player switch AND on special state activation so content slides in fresh
  const animKey = `${player.id}-${bonusMoveActive}-${portalActive}`;

  return (
    <div
      className={`turn-indicator-shell ${urgent ? 'turn-indicator-urgent' : ''}`}
      style={{ borderColor: player.color }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={animKey}
          className="turn-indicator-inner"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -24, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
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
                  style={{ width: `${pct}%`, backgroundColor: urgent ? '#e74c3c' : player.color }}
                />
              </div>
              <span className={`timer-count ${urgent ? 'timer-count-urgent' : ''}`}>
                {timeLeft}
              </span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

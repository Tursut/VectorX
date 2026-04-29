import { AnimatePresence, motion } from 'framer-motion';
import { GREMLIN_THOUGHTS } from '../game/ai';
import SoundToggle from './SoundToggle';

export default function TurnIndicator({ player, taunt, timeLeft, totalTime, portalActive, swapActive, freezeSelectActive, isGremlin, isThinking, soundEnabled, onToggleSound }) {
  const pct = (timeLeft / totalTime) * 100;
  const urgent = timeLeft <= 3 && !isGremlin;
  const isReset = timeLeft === totalTime;

  let statusLine = taunt;
  if (isThinking) statusLine = GREMLIN_THOUGHTS[player.id] ?? 'Scheming…';
  else if (portalActive) statusLine = '🌀 PORTAL active! Pick any empty square on the board.';
  else if (swapActive) statusLine = '🎭 SWAP! Choose a player to switch places with.';
  else if (freezeSelectActive) statusLine = '❄️ FREEZE! Choose a player to skip for 3 turns.';

  const animKey = `${player.id}-${portalActive}-${swapActive}-${freezeSelectActive}`;

  return (
    <div
      className={`turn-indicator-shell ${urgent ? 'turn-indicator-urgent' : ''}`}
      style={{ borderColor: player.color }}
    >
      <div className="turn-indicator-sound">
        <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      </div>
      <AnimatePresence>
        <motion.div
          key={animKey}
          className="turn-indicator-inner"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -24, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className={`turn-icon ${isThinking ? 'turn-icon-thinking' : ''}`} style={{ backgroundColor: player.color }}>
            {isThinking ? '🤔' : player.icon}
          </div>
          <div className="turn-text">
            <div className="turn-name" data-testid="turn-name" style={{ color: player.color }}>
              {player.name}
            </div>
            <div className={`turn-taunt ${isThinking ? 'turn-taunt-thinking' : ''} ${portalActive || swapActive || freezeSelectActive ? 'turn-taunt-special' : ''}`}>
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
                    transition: isReset ? 'none' : 'width 0.85s linear, background-color 0.3s',
                  }}
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

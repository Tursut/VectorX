import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';
import { GREMLIN_THOUGHTS } from '../game/ai';

const FREEZE_LINES = [
  (by, target) => `❄️ ${by} froze ${target}. Cold-blooded.`,
  (by, target) => `❄️ ${target} is on ice. ${by} sends regards.`,
  (by, target) => `❄️ ${by} hit ${target} with a freeze ray. Uncalled for, honestly.`,
];

export default function TurnIndicator({ player, taunt, timeLeft, totalTime, bonusMoveActive, portalActive, lastEvent, isGremlin, isThinking }) {
  const pct = (timeLeft / totalTime) * 100;
  const urgent = timeLeft <= 3 && !isGremlin;

  let statusLine = taunt;
  if (isThinking) statusLine = GREMLIN_THOUGHTS[player.id] ?? 'Scheming…';
  else if (portalActive) statusLine = '🌀 PORTAL active! Pick any empty square on the board.';
  else if (bonusMoveActive) statusLine = `🚀 ${player.shortName} found turbo. One more move — make it sting.`;

  let eventLine = null;
  if (lastEvent?.type === 'freeze') {
    const by = PLAYERS[lastEvent.byId].shortName;
    const target = lastEvent.targetId != null ? PLAYERS[lastEvent.targetId].shortName : null;
    if (target) {
      const line = FREEZE_LINES[(lastEvent.byId + lastEvent.targetId) % FREEZE_LINES.length];
      eventLine = line(by, target);
    }
  }

  const animKey = `${player.id}-${bonusMoveActive}-${portalActive}`;

  return (
    <div
      className={`turn-indicator-shell ${urgent ? 'turn-indicator-urgent' : ''}`}
      style={{ borderColor: player.color }}
    >
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
            <div className="turn-name" style={{ color: player.color }}>
              {player.name}
            </div>
            <div className={`turn-taunt ${isThinking ? 'turn-taunt-thinking' : ''} ${portalActive || bonusMoveActive ? 'turn-taunt-special' : ''}`}>
              {statusLine}
            </div>
            <div className="turn-event-line" style={{ visibility: eventLine ? 'visible' : 'hidden' }}>
              {eventLine ?? '\u00a0'}
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

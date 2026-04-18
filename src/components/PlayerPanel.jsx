import { motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

export default function PlayerPanel({ players, currentPlayerIndex, gremlinCount = 0 }) {
  return (
    <div className="player-panel">
      {players.map((p) => {
        const config = PLAYERS[p.id];
        const isCurrent = p.id === currentPlayerIndex && !p.isEliminated;
        const isGremlin = p.id >= PLAYERS.length - gremlinCount;
        return (
          <motion.div
            key={p.id}
            className="player-card"
            style={{ borderColor: config.color }}
            animate={{
              scale: isCurrent ? 1.06 : 1,
              opacity: p.isEliminated ? 0.32 : 1,
              filter: p.isEliminated ? 'grayscale(0.85)' : 'grayscale(0)',
            }}
            transition={{ duration: 0.45 }}
          >
            <div className="player-card-icon" style={{ backgroundColor: config.color }}>
              {p.isEliminated ? '💀' : config.icon}
            </div>
            <div className="player-card-name" style={{ color: config.color }}>
              {config.shortName}
            </div>
            <div className={
              isCurrent && !p.isEliminated ? 'player-card-turn' :
              p.isEliminated ? 'player-card-rip' :
              isGremlin ? 'player-card-gremlin' : 'player-card-empty'
            }>
              {isCurrent && !p.isEliminated ? '← NOW' :
               p.isEliminated ? 'R.I.P.' :
               isGremlin ? '👾' : '\u00a0'}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

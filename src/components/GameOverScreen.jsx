import { motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const ELIMINATION_LINES = [
  (name, quote) => `${name} has ${quote}. A moment of silence.`,
  (name, quote) => `${name}: ${quote}. Better luck next time. (There may not be a next time.)`,
];

export default function GameOverScreen({ winner, players, onRestart, onMenu }) {
  const eliminated = players.filter((p) => p.isEliminated);

  return (
    <div className="gameover-screen">
      <div className="gameover-content">
        {winner ? (
          <>
            <motion.div
              className="gameover-winner-icon"
              style={{ backgroundColor: winner.color }}
              initial={{ scale: 0, rotate: -200 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 13 }}
            >
              {winner.icon}
            </motion.div>

            <motion.h1
              className="gameover-title"
              style={{ color: winner.color }}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, type: 'spring', stiffness: 300, damping: 22 }}
            >
              {winner.name.toUpperCase()} WINS!
            </motion.h1>

            <motion.p
              className="gameover-quote"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.44, duration: 0.4 }}
            >
              {winner.winQuote}
            </motion.p>
          </>
        ) : (
          <>
            <motion.div
              className="gameover-winner-icon"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            >
              🤝
            </motion.div>
            <motion.h1
              className="gameover-title"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              IT'S A DRAW!
            </motion.h1>
            <motion.p
              className="gameover-quote"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              Nobody wins. Everyone loses. Oddly fitting.
            </motion.p>
          </>
        )}

        {eliminated.length > 0 && (
          <motion.div
            className="gameover-eliminated"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.35 }}
          >
            <h3>The fallen:</h3>
            {eliminated.map((p, i) => {
              const config = PLAYERS[p.id];
              const line = ELIMINATION_LINES[p.id % ELIMINATION_LINES.length];
              return (
                <motion.div
                  key={p.id}
                  className="gameover-eliminated-entry"
                  style={{ color: config.color }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + i * 0.1 }}
                >
                  {config.icon} {line(config.shortName, config.deathQuote)}
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <motion.div
          className="gameover-buttons"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.85 }}
        >
          <button className="gameover-button gameover-button-primary" onClick={onRestart}>
            PLAY AGAIN
          </button>
          <button className="gameover-button gameover-button-secondary" onClick={onMenu}>
            Main Menu
          </button>
        </motion.div>
      </div>
    </div>
  );
}

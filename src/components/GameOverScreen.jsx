import { motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const MEDALS = ['🥇', '🥈', '🥉', '💀'];

export default function GameOverScreen({ winner, players, onRestart, onMenu }) {
  // Build ranked list: winner first, then eliminated sorted by finishTurn DESC
  // (last eliminated = runner-up, first eliminated = last place)
  const eliminated = [...players.filter(p => p.isEliminated)]
    .sort((a, b) => (b.finishTurn ?? 0) - (a.finishTurn ?? 0));

  const ranked = [
    ...(winner ? [{ config: winner, isWinner: true }] : []),
    ...eliminated.map(p => ({ config: PLAYERS[p.id], isWinner: false })),
  ];

  const isDraw = !winner;

  return (
    <div className="gameover-screen">
      <div className="gameover-content">

        {/* Header */}
        {winner ? (
          <>
            <motion.div
              className="gameover-winner-icon"
              style={{ backgroundColor: winner.color }}
              initial={{ scale: 0, rotate: -200 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 13 }}
            >
              {winner.icon ?? '🏆'}
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

        {/* Finishing order leaderboard */}
        {ranked.length > 0 && (
          <motion.div
            className="gameover-leaderboard"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.3 }}
          >
            <div className="gameover-leaderboard-title">
              {isDraw ? 'SURVIVAL ORDER' : 'FINISHING ORDER'}
            </div>
            {ranked.map(({ config, isWinner }, i) => (
              <motion.div
                key={config.id}
                className={`gameover-rank-row ${isWinner ? 'gameover-rank-winner' : ''}`}
                style={{ '--rank-color': config.color }}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.65 + i * 0.12, type: 'spring', stiffness: 280, damping: 24 }}
              >
                <span className="gameover-rank-medal">{MEDALS[i] ?? '💀'}</span>
                <div className="gameover-rank-avatar" style={{ backgroundColor: config.color }}>
                  {config.icon}
                </div>
                <span className="gameover-rank-name" style={{ color: config.color }}>
                  {config.shortName}
                </span>
                {isWinner && <span className="gameover-rank-badge">WINNER</span>}
              </motion.div>
            ))}
          </motion.div>
        )}

        <motion.div
          className="gameover-buttons"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
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

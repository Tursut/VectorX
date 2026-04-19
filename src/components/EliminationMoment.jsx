import { motion } from 'framer-motion';

export default function EliminationMoment({ player }) {
  return (
    <motion.div
      className="elim-moment-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="elim-moment-card"
        initial={{ scale: 0.6, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <div className="elim-moment-icon-row">
          <div className="elim-moment-avatar" style={{ backgroundColor: player.color }}>
            {player.icon}
          </div>
          <span className="elim-moment-skull">💀</span>
        </div>
        <div className="elim-moment-name" style={{ color: player.color }}>
          {player.name.toUpperCase()}
        </div>
        <div className="elim-moment-label">ELIMINATED</div>
        <div className="elim-moment-quote">"{player.deathQuote}"</div>
      </motion.div>
    </motion.div>
  );
}

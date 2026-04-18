import { motion } from 'framer-motion';

const spring = { type: 'spring', stiffness: 400, damping: 24 };

export default function EventToast({ toast }) {
  if (toast.type === 'boost') {
    const { player } = toast;
    return (
      <motion.div
        className="event-toast event-toast-boost"
        style={{ borderColor: player.color, boxShadow: `0 0 48px ${player.color}66, 0 8px 32px rgba(0,0,0,0.6)` }}
        initial={{ scale: 0.55, opacity: 0, y: -24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.22 } }}
        transition={spring}
      >
        <div className="event-toast-icon" style={{ backgroundColor: player.color }}>
          {player.icon}
        </div>
        <div className="event-toast-title" style={{ color: player.color }}>TURBO!</div>
        <div className="event-toast-body">{player.shortName} gets one extra move.</div>
        <div className="event-toast-flavor">Everyone else: start panicking.</div>
      </motion.div>
    );
  }

  if (toast.type === 'freeze') {
    const { by, target } = toast;
    return (
      <motion.div
        className="event-toast event-toast-freeze"
        initial={{ scale: 0.55, opacity: 0, y: -24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.22 } }}
        transition={spring}
      >
        <div className="event-toast-players">
          <div className="event-toast-icon" style={{ backgroundColor: by.color }}>{by.icon}</div>
          <span className="event-toast-zap">❄️</span>
          {target && (
            <div className="event-toast-icon event-toast-frozen" style={{ backgroundColor: target.color }}>
              {target.icon}
            </div>
          )}
        </div>
        <div className="event-toast-title" style={{ color: '#7dd3fc' }}>FROZEN!</div>
        <div className="event-toast-body">
          {by.shortName} iced {target?.shortName ?? 'the next player'}.
        </div>
        <div className="event-toast-flavor">Their turn? Cancelled.</div>
      </motion.div>
    );
  }

  return null;
}

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';
import * as sounds from '../game/sounds';

const MEDALS = ['🥇', '🥈', '🥉', '💀'];

export default function GameOverScreen({
  winner,
  players,
  onRestart,
  onMenu,
  restartLabel = 'PLAY AGAIN',
  restartDisabled = false,
  heroPlaying = false,
}) {
  // Draw sound fires once on mount — draws skip the hero phase entirely.
  useEffect(() => {
    if (!winner) sounds.playDraw();
  // Mount-only: the leaderboard never swaps winner ↔ draw under the user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Win fanfare fires the moment the leaderboard chrome appears (#60) —
  // useWinnerHero plays a short stinger when the hero phase opens, and
  // this longer fanfare comes in when the hero ends and the rest of the
  // leaderboard bleeds in around the trophy. fanfareFiredRef latches so
  // a re-render of GameOverScreen with heroPlaying still false (the
  // common case after the hero ends) doesn't re-trigger.
  const fanfareFiredRef = useRef(false);
  useEffect(() => {
    if (!winner) return;
    if (heroPlaying) return;
    if (fanfareFiredRef.current) return;
    fanfareFiredRef.current = true;
    sounds.playWin();
  }, [winner, heroPlaying]);
  // Build ranked list: winner first, then eliminated sorted by finishTurn DESC
  // (last eliminated = runner-up, first eliminated = last place)
  const eliminated = [...players.filter(p => p.isEliminated)]
    .sort((a, b) => (b.finishTurn ?? 0) - (a.finishTurn ?? 0));

  const ranked = [
    ...(winner ? [{ config: winner, runtimePlayer: null, isWinner: true }] : []),
    ...eliminated.map((p) => ({
      config: PLAYERS[p.id],
      runtimePlayer: p,
      isWinner: false,
    })),
  ];

  const isDraw = !winner;
  // Hero phase only applies to wins. Draws skip straight to the
  // full leaderboard.
  const inHero = heroPlaying && !!winner;

  return (
    <div className="gameover-screen">
      <div className="gameover-content">

        {/* Trophy — always rendered, mounts ONCE so the user sees a
            single grow-in at the start of the hero phase and the
            leaderboard chrome bleeds in around it ~1 s later. */}
        {winner ? (
          <motion.div
            className="gameover-winner-icon"
            style={{ backgroundColor: winner.color }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          >
            {winner.icon ?? '🏆'}
          </motion.div>
        ) : (
          <motion.div
            className="gameover-winner-icon"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14 }}
          >
            🤝
          </motion.div>
        )}

        {/* Hero "WINNER!" text — replaces the leaderboard chrome for
            ~1 s while the win sound plays. Exits as the rest of the
            screen fades in. Draw branch never enters hero, so this
            block is gated on inHero. */}
        <AnimatePresence>
          {inHero && (
            <motion.div
              key="hero-text"
              className="gameover-hero-text"
              style={{ color: winner.color }}
              initial={{ y: 32, opacity: 0, rotate: -6 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ delay: 0.18, type: 'spring', stiffness: 280, damping: 14 }}
            >
              <motion.span
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                WINNER!
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Title + quote + leaderboard + buttons — full leaderboard
            chrome that bleeds in around the trophy after hero ends.
            Hidden during inHero so it doesn't compete with the
            spotlight; once mounted, runs the existing staggered
            entrance. Keyed on inHero so the entrance animations
            re-fire when the chrome appears. */}
        {!inHero && (
          <>
            {winner ? (
              <>
                <motion.h1
                  className="gameover-title"
                  style={{ color: winner.color }}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                >
                  {winner.name.toUpperCase()} WINS!
                </motion.h1>
                <motion.p
                  className="gameover-quote"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.22, duration: 0.4 }}
                >
                  {winner.winQuote}
                </motion.p>
              </>
            ) : (
              <>
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

            {ranked.length > 0 && (
              <motion.div
                className="gameover-leaderboard"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.33, duration: 0.3 }}
              >
                <div className="gameover-leaderboard-title">
                  {isDraw ? 'SURVIVAL ORDER' : 'FINISHING ORDER'}
                </div>
                {ranked.map(({ config, runtimePlayer, isWinner }, i) => (
                  <motion.div
                    key={config.id}
                    className={`gameover-rank-row ${isWinner ? 'gameover-rank-winner' : ''}`}
                    style={{ '--rank-color': config.color }}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.43 + i * 0.1, type: 'spring', stiffness: 280, damping: 24 }}
                  >
                    <span className="gameover-rank-medal">{MEDALS[i] ?? '💀'}</span>
                    <div className="gameover-rank-avatar" style={{ backgroundColor: config.color }}>
                      {config.icon}
                    </div>
                    <span className="gameover-rank-name" style={{ color: config.color }}>
                      {runtimePlayer?.displayName ?? config.shortName}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}

            <motion.div
              className="gameover-buttons"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              <button
                className="gameover-button gameover-button-primary"
                onClick={onRestart}
                disabled={restartDisabled}
              >
                {restartLabel}
              </button>
              <button className="gameover-button gameover-button-secondary" onClick={onMenu}>
                MAIN MENU
              </button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}

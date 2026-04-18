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
            <div className="gameover-winner-icon" style={{ backgroundColor: winner.color }}>
              {winner.icon}
            </div>
            <h1 className="gameover-title" style={{ color: winner.color }}>
              {winner.name.toUpperCase()} WINS!
            </h1>
            <p className="gameover-quote">{winner.winQuote}</p>
          </>
        ) : (
          <>
            <div className="gameover-winner-icon">🤝</div>
            <h1 className="gameover-title">IT'S A DRAW!</h1>
            <p className="gameover-quote">
              Nobody wins. Everyone loses. Oddly fitting.
            </p>
          </>
        )}

        {eliminated.length > 0 && (
          <div className="gameover-eliminated">
            <h3>The fallen:</h3>
            {eliminated.map((p) => {
              const config = PLAYERS[p.id];
              const line = ELIMINATION_LINES[p.id % ELIMINATION_LINES.length];
              return (
                <div key={p.id} className="gameover-eliminated-entry" style={{ color: config.color }}>
                  {config.icon} {line(config.shortName, config.deathQuote)}
                </div>
              );
            })}
          </div>
        )}

        <div className="gameover-buttons">
          <button className="gameover-button gameover-button-primary" onClick={onRestart}>
            PLAY AGAIN
          </button>
          <button className="gameover-button gameover-button-secondary" onClick={onMenu}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

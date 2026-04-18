import { PLAYERS } from '../game/constants';

export default function PlayerPanel({ players, currentPlayerIndex }) {
  return (
    <div className="player-panel">
      {players.map((p) => {
        const config = PLAYERS[p.id];
        const isCurrent = p.id === currentPlayerIndex && !p.isEliminated;
        return (
          <div
            key={p.id}
            className={`player-card ${isCurrent ? 'player-card-active' : ''} ${p.isEliminated ? 'player-card-eliminated' : ''}`}
            style={{ borderColor: config.color }}
          >
            <div className="player-card-icon" style={{ backgroundColor: config.color }}>
              {p.isEliminated ? '💀' : config.icon}
            </div>
            <div className="player-card-name" style={{ color: config.color }}>
              {config.shortName}
            </div>
            {p.isEliminated && <div className="player-card-rip">R.I.P.</div>}
            {isCurrent && <div className="player-card-turn">← NOW</div>}
          </div>
        );
      })}
    </div>
  );
}

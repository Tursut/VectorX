import { PLAYERS } from '../game/constants';

export default function StartScreen({ onStart }) {
  return (
    <div className="start-screen">
      <div className="start-content">
        <h1 className="start-title">GRID TERRITORY</h1>
        <p className="start-subtitle">
          Four heroes. One grid. Absolutely no friendship will survive this.
        </p>

        <div className="start-characters">
          {PLAYERS.map((p) => (
            <div key={p.id} className="start-character" style={{ borderColor: p.color }}>
              <div className="start-character-icon" style={{ backgroundColor: p.color }}>
                {p.icon}
              </div>
              <div className="start-character-name" style={{ color: p.color }}>
                {p.name}
              </div>
            </div>
          ))}
        </div>

        <div className="start-rules">
          <p>🗺️ Move onto any adjacent square — including diagonally.</p>
          <p>🔒 Claimed squares are locked forever. No take-backs.</p>
          <p>💀 No moves left? You're out. Try not to corner yourself.</p>
          <p>🏆 Last one moving wins. Simple. Brutal. Perfect.</p>
        </div>

        <button className="start-button" onClick={onStart}>
          BEGIN CHAOS →
        </button>

        <p className="start-footnote">Starting player is chosen by the chaos gods (random).</p>
      </div>
    </div>
  );
}

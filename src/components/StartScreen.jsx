import { PLAYERS, ITEM_TYPES } from '../game/constants';

export default function StartScreen({ onStart, magicItems, onToggleMagicItems, gremlinCount, onChangeGremlinCount }) {
  const gremlinLabel =
    gremlinCount === 0 ? 'No Gremlins — pure human chaos.' :
    gremlinCount === 4 ? 'All Gremlins — sit back and watch the carnage.' :
    `${gremlinCount} Gremlin${gremlinCount > 1 ? 's' : ''} — they play dirty. You've been warned.`;

  return (
    <div className="start-screen">
      <div className="start-content">
        <h1 className="start-title">GRID TERRITORY</h1>
        <p className="start-subtitle">
          Four heroes. One grid. Absolutely no friendship will survive this.
        </p>

        <div className="start-characters">
          {PLAYERS.map((p) => {
            const isGremlin = p.id >= PLAYERS.length - gremlinCount;
            return (
              <div key={p.id} className={`start-character ${isGremlin ? 'start-character-gremlin' : ''}`} style={{ borderColor: p.color }}>
                <div className="start-character-icon" style={{ backgroundColor: p.color }}>
                  {p.icon}
                </div>
                <div className="start-character-name" style={{ color: p.color }}>
                  {p.name}
                </div>
                {isGremlin && <div className="start-character-badge">👾 GREMLIN</div>}
              </div>
            );
          })}
        </div>

        {/* Gremlin slider */}
        <div className="gremlin-section">
          <div className="gremlin-header">
            <span className="gremlin-title">👾 Gremlins</span>
            <span className="gremlin-value">{gremlinCount} / 4</span>
          </div>
          <input
            type="range"
            min="0"
            max="4"
            value={gremlinCount}
            onChange={(e) => onChangeGremlinCount(Number(e.target.value))}
            className="gremlin-slider"
          />
          <p className="gremlin-sub">{gremlinLabel}</p>
        </div>

        <div className="start-rules">
          <p>🗺️ Move onto any adjacent square — including diagonally.</p>
          <p>🔒 Claimed squares are locked forever. No take-backs.</p>
          <p>💀 No moves left? You're out. Try not to corner yourself.</p>
          <p>🏆 Last one moving wins. Simple. Brutal. Perfect.</p>
        </div>

        {/* Magic Items Toggle */}
        <div className="magic-toggle" onClick={onToggleMagicItems}>
          <div className={`magic-toggle-track ${magicItems ? 'magic-toggle-on' : ''}`}>
            <div className="magic-toggle-thumb" />
          </div>
          <div className="magic-toggle-label">
            <span className="magic-toggle-title">
              ✨ Magic Items {magicItems ? 'ON' : 'OFF'}
            </span>
            <span className="magic-toggle-sub">
              {magicItems ? 'Items will appear on the board mid-game.' : 'Clean game, no chaos.'}
            </span>
          </div>
        </div>

        {magicItems && (
          <div className="magic-items-list">
            {Object.values(ITEM_TYPES).map((item) => (
              <div key={item.type} className="magic-item-entry">
                <span className="magic-item-icon">{item.icon}</span>
                <div>
                  <span className="magic-item-name" style={{ color: item.color }}>{item.name}</span>
                  <span className="magic-item-desc"> — {item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="start-button" onClick={onStart}>
          BEGIN CHAOS →
        </button>

        <p className="start-footnote">Starting player is chosen by the chaos gods (random).</p>
      </div>
    </div>
  );
}

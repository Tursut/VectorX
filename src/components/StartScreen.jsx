import { PLAYERS, ITEM_TYPES } from '../game/constants';

export default function StartScreen({ onStart, onSandbox, magicItems, onToggleMagicItems, gremlinCount, onChangeGremlinCount }) {
  const humanCount = PLAYERS.length - gremlinCount;
  const gremlinLabel =
    gremlinCount === 0 ? 'All human. May the best player win.' :
    gremlinCount === 4 ? 'All gremlins — sit back and enjoy the show.' :
    humanCount === 1 ? 'Just you vs the gremlins. Good luck.' :
    `${humanCount} humans, ${gremlinCount} gremlins.`;

  return (
    <div className="start-screen">
      <div className="start-content">
        <h1 className="start-title">GRIDMIND</h1>
        <p className="start-subtitle">
          Four players. One grid. Only one walks away smiling.
        </p>

        {/* Gremlin / player setup */}
        <div className="gremlin-section">
          <p className="gremlin-question">Who's playing?</p>
          <div className="gremlin-slots">
            {PLAYERS.map((p) => {
              const isGremlin = p.id >= PLAYERS.length - gremlinCount;
              return (
                <div key={p.id} className={`gremlin-slot ${isGremlin ? 'gremlin-slot-bot' : 'gremlin-slot-human'}`}>
                  <div
                    className="gremlin-slot-avatar"
                    style={isGremlin ? {} : { backgroundColor: p.color }}
                  >
                    {isGremlin ? '👾' : p.icon}
                  </div>
                  <span className="gremlin-slot-name" style={isGremlin ? {} : { color: p.color }}>
                    {p.shortName}
                  </span>
                  <span className="gremlin-slot-type">
                    {isGremlin ? 'gremlin' : 'human'}
                  </span>
                </div>
              );
            })}
          </div>
          <input
            type="range"
            min="0"
            max="4"
            value={4 - gremlinCount}
            onChange={(e) => onChangeGremlinCount(4 - Number(e.target.value))}
            className="gremlin-slider"
          />
          <p className="gremlin-sub">{gremlinLabel}</p>
        </div>

        {/* Game mode selector */}
        <div className="mode-section">
          <div className="mode-selector">
            <button
              className={`mode-btn ${magicItems ? 'mode-btn-active mode-btn-magic' : ''}`}
              onClick={() => !magicItems && onToggleMagicItems()}
            >
              <span className="mode-btn-icon">✨</span>
              <span className="mode-btn-label">MAGIC</span>
              <span className="mode-btn-sub">Items appear. Things get interesting.</span>
            </button>
            <button
              className={`mode-btn ${!magicItems ? 'mode-btn-active mode-btn-classic' : ''}`}
              onClick={() => magicItems && onToggleMagicItems()}
            >
              <span className="mode-btn-icon">⚔️</span>
              <span className="mode-btn-label">CLASSIC</span>
              <span className="mode-btn-sub">Pure territory, no surprises.</span>
            </button>
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
        </div>

        <div className="start-rules">
          <p>🗺️ Move onto any adjacent square — including diagonally.</p>
          <p>🔒 Claimed squares are locked forever. No take-backs.</p>
          <p>💀 No moves left? You're out. Try not to corner yourself.</p>
          <p>🏆 Last one moving wins. Simple. Clever. Perfect.</p>
        </div>

        <p className="start-footnote">Starting player chosen by fate (it's random).</p>
      </div>

      {/* Sticky begin button — always visible at bottom */}
      <div className="start-button-bar">
        <button className="start-button" onClick={onStart}>
          TAKE THE GRID →
        </button>
        <button className="sandbox-entry-btn" onClick={onSandbox}>
          🧪 Testing Ground
        </button>
      </div>
    </div>
  );
}

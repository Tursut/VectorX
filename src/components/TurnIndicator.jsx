export default function TurnIndicator({ player, taunt }) {
  return (
    <div className="turn-indicator" style={{ borderColor: player.color }}>
      <div className="turn-icon" style={{ backgroundColor: player.color }}>
        {player.icon}
      </div>
      <div className="turn-text">
        <div className="turn-name" style={{ color: player.color }}>
          {player.name}
        </div>
        <div className="turn-taunt">{taunt}</div>
      </div>
    </div>
  );
}

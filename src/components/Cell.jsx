import { PLAYERS, ITEM_TYPES } from '../game/constants';

function badgeColor(turnsLeft) {
  if (turnsLeft >= 4) return '#27ae60';
  if (turnsLeft === 3) return '#f39c12';
  if (turnsLeft === 2) return '#e67e22';
  return '#e74c3c';
}

export default function Cell({ row, col, cell, isValidMove, isCurrentPlayer, playerHere, deathHere, itemHere, portalActive, onCellClick }) {
  const owner = cell.owner !== null ? PLAYERS[cell.owner] : null;

  function handleClick() {
    if (isValidMove) onCellClick(row, col);
  }

  let className = 'cell';
  if (owner) className += ' cell-owned';
  if (isValidMove) className += portalActive ? ' cell-portal' : ' cell-valid';
  if (isCurrentPlayer) className += ' cell-current';

  return (
    <div
      className={className}
      style={owner ? { backgroundColor: owner.color } : {}}
      onClick={handleClick}
      role={isValidMove ? 'button' : undefined}
      aria-label={isValidMove ? `Move to row ${row + 1}, column ${col + 1}` : undefined}
    >
      {playerHere && (
        <span className={`player-icon ${isCurrentPlayer ? 'player-icon-active' : ''}`}>
          {playerHere.icon}
        </span>
      )}

      {deathHere && !playerHere && (
        <span className="death-tombstone">🪦</span>
      )}

      {itemHere && !playerHere && (
        <div className="item-wrapper">
          <span className="item-icon">{ITEM_TYPES[itemHere.type]?.icon}</span>
          <span
            className="item-badge"
            style={{ backgroundColor: badgeColor(itemHere.turnsLeft) }}
          >
            {itemHere.turnsLeft}
          </span>
        </div>
      )}

      {isValidMove && !playerHere && !itemHere && <span className="valid-move-dot" />}
    </div>
  );
}

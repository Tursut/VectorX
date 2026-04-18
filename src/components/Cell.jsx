import { PLAYERS } from '../game/constants';

export default function Cell({ row, col, cell, isValidMove, isCurrentPlayer, playerHere, deathHere, onCellClick }) {
  const owner = cell.owner !== null ? PLAYERS[cell.owner] : null;

  function handleClick() {
    if (isValidMove) onCellClick(row, col);
  }

  let className = 'cell';
  if (owner) className += ' cell-owned';
  if (isValidMove) className += ' cell-valid';
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

      {deathHere && (
        <span className="death-tombstone">🪦</span>
      )}

      {isValidMove && !playerHere && <span className="valid-move-dot" />}
    </div>
  );
}

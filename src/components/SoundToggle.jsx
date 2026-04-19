export default function SoundToggle({ enabled, onToggle }) {
  return (
    <button
      className={`sound-btn${enabled ? '' : ' sound-btn-muted'}`}
      onClick={onToggle}
      title={enabled ? 'Mute' : 'Unmute'}
      aria-label={enabled ? 'Mute' : 'Unmute'}
    >
      <svg width="15" height="14" viewBox="0 0 15 14" fill="none" aria-hidden="true">
        <path d="M1 5H3.5L7 2.5V11.5L3.5 9H1V5Z" fill="currentColor" />
        {enabled ? (
          <>
            <path d="M9 6C10 6 10 8 9 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M10.5 4.5C12.5 4.5 12.5 9.5 10.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <line x1="9.5" y1="5.5" x2="12.5" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12.5" y1="5.5" x2="9.5" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}

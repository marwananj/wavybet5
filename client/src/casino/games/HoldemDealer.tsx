/**
 * The Hold'em croupier: an original illustrated dealer (vest, bow tie, blinking eyes) with a
 * speech bubble, plus the riffle-shuffle deck that sits in front of them.
 */
export type DealerMood = 'idle' | 'talk' | 'happy' | 'sad';

export function HoldemDealer({ mood, line, lineKey, dealing }: { mood: DealerMood; line: string | null; lineKey: number; dealing: boolean }) {
  const mouth =
    mood === 'happy' ? 'M52 63 Q60 71 68 63' : mood === 'sad' ? 'M53 67 Q60 62 67 67' : mood === 'talk' ? 'M54 63 Q60 69 66 63 Q60 66 54 63' : 'M54 64 Q60 67 66 64';
  return (
    <div className={`hd ${mood} ${dealing ? 'dealing' : ''}`}>
      {line && (
        <div className="hd-bubble" key={lineKey}>
          {line}
        </div>
      )}
      <svg className="hd-svg" viewBox="0 0 120 112" aria-label="Dealer">
        <defs>
          <linearGradient id="hdSkin" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f3c9a4" />
            <stop offset="1" stopColor="#dca47c" />
          </linearGradient>
          <linearGradient id="hdVest" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1f2430" />
            <stop offset="1" stopColor="#0c0f16" />
          </linearGradient>
          <linearGradient id="hdHair" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3a2418" />
            <stop offset="1" stopColor="#1e120b" />
          </linearGradient>
        </defs>
        {/* body */}
        <path d="M14 112 C16 88 30 80 60 80 C90 80 104 88 106 112 Z" fill="#f4f6fb" />
        <path d="M14 112 C16 90 28 82 46 80 L56 112 Z" fill="url(#hdVest)" />
        <path d="M106 112 C104 90 92 82 74 80 L64 112 Z" fill="url(#hdVest)" />
        <circle cx="60" cy="96" r="1.6" fill="#c9a24a" />
        <circle cx="60" cy="105" r="1.6" fill="#c9a24a" />
        {/* name badge */}
        <rect x="76" y="92" width="16" height="6" rx="1.5" fill="#c9a24a" />
        {/* neck + bow tie */}
        <rect x="53" y="70" width="14" height="12" rx="4" fill="url(#hdSkin)" />
        <path d="M60 82 L49 77 L49 88 Z M60 82 L71 77 L71 88 Z" fill="#b3122e" />
        <circle cx="60" cy="82" r="3" fill="#8d0c22" />
        {/* head */}
        <ellipse cx="60" cy="48" rx="21" ry="25" fill="url(#hdSkin)" />
        <ellipse cx="39.5" cy="50" rx="3.5" ry="6" fill="#dca47c" />
        <ellipse cx="80.5" cy="50" rx="3.5" ry="6" fill="#dca47c" />
        <path d="M38 44 C36 22 50 16 62 17 C76 18 86 26 82 44 C80 34 74 28 62 29 C52 30 44 32 38 44 Z" fill="url(#hdHair)" />
        <path d="M44 31 C52 24 66 23 74 28" stroke="#5a3a26" strokeWidth="1.4" fill="none" opacity=".6" />
        {/* brows + eyes */}
        <path className="hd-brow" d="M46 40 Q51 37 56 40 M64 40 Q69 37 74 40" stroke="#2a1a10" strokeWidth="2" fill="none" strokeLinecap="round" />
        <g className="hd-eyes">
          <ellipse cx="51" cy="47" rx="2.6" ry="3" fill="#1b1b22" />
          <ellipse cx="69" cy="47" rx="2.6" ry="3" fill="#1b1b22" />
          <circle cx="52" cy="46" r=".8" fill="#fff" />
          <circle cx="70" cy="46" r=".8" fill="#fff" />
        </g>
        <path d="M60 50 Q58 56 61 57" stroke="#c28a63" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path className="hd-mouth" d={mouth} stroke="#7a2d25" strokeWidth="2" fill={mood === 'talk' ? '#7a2d25' : 'none'} strokeLinecap="round" />
        <ellipse cx="46" cy="56" rx="4" ry="2.2" fill="#e88b7a" opacity=".25" />
        <ellipse cx="74" cy="56" rx="4" ry="2.2" fill="#e88b7a" opacity=".25" />
      </svg>
      {/* hands resting on the rail — the right one sweeps when dealing */}
      <span className="hd-hand l" />
      <span className="hd-hand r" />
    </div>
  );
}

/** A deck riffling together (while shuffling), or a neat stack waiting in the shoe. */
export function ShuffleDeck({ shuffling }: { shuffling: boolean }) {
  return (
    <div className={`he-deck ${shuffling ? 'shuffling' : ''}`} aria-hidden>
      {shuffling ? (
        <>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={`l${i}`} className="hd-c l" style={{ ['--i' as string]: i }} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={`r${i}`} className="hd-c r" style={{ ['--i' as string]: i }} />
          ))}
        </>
      ) : (
        [0, 1, 2, 3].map((i) => <i key={i} className="hd-c stack" style={{ ['--i' as string]: i }} />)
      )}
    </div>
  );
}

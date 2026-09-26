export const usd = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type OddsFormat = 'decimal' | 'fractional' | 'american';
let ODDS_FMT: OddsFormat = (() => {
  try {
    const v = localStorage.getItem('wb_odds');
    return v === 'fractional' || v === 'american' ? v : 'decimal';
  } catch {
    return 'decimal';
  }
})();
export const getOddsFormat = () => ODDS_FMT;
export function setOddsFormat(f: OddsFormat) {
  ODDS_FMT = f;
  try {
    localStorage.setItem('wb_odds', f);
  } catch {
    /* ignore */
  }
}
/** decimal → nearest simple fraction (e.g. 2.50 → 3/2, 1.91 → 10/11) */
function toFraction(dec: number) {
  const x = dec - 1;
  if (x <= 0) return '0/1';
  let best = [Math.round(x), 1];
  let err = Math.abs(x - best[0]);
  for (let d = 1; d <= 40; d++) {
    const n = Math.round(x * d);
    const e = Math.abs(x - n / d);
    if (n > 0 && e < err - 1e-9) {
      best = [n, d];
      err = e;
      if (e < 0.005) break;
    }
  }
  return `${best[0]}/${best[1]}`;
}
/** Odds in the player's chosen format (Decimal / Fractional / American). */
export const odds = (v: number | string) => {
  const d = Number(v);
  if (!Number.isFinite(d) || d <= 1) return d.toFixed(2);
  if (ODDS_FMT === 'fractional') return toFraction(d);
  if (ODDS_FMT === 'american') return d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
  return d.toFixed(2);
};

export const MARKET_LABEL: Record<string, string> = {
  h2h: 'Match result',
  totals: 'Total goals',
  btts: 'Both teams to score',
  double_chance: 'Double chance',
  ht_h2h: '1st half result',
  ht_totals: '1st half goals',
  correct_score: 'Correct score',
  corners_totals: 'Total corners',
  corners_h2h: 'Most corners',
};
export const marketLabel = (k: string) => MARKET_LABEL[k] ?? k;

export function kickoff(iso: string | Date) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export const dateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** "Soccer - England Premier League" style split */
export function leagueParts(sportKey: string, sportTitle: string) {
  const group = sportKey.split('_')[0];
  const map: Record<string, string> = {
    soccer: 'Soccer', basketball: 'Basketball', tennis: 'Tennis', mma: 'MMA', icehockey: 'Ice Hockey',
    americanfootball: 'American Football', baseball: 'Baseball', boxing: 'Boxing', cricket: 'Cricket',
    rugbyleague: 'Rugby League', rugbyunion: 'Rugby Union', aussierules: 'Aussie Rules', golf: 'Golf', handball: 'Handball', lacrosse: 'Lacrosse',
  };
  return { group, groupTitle: map[group] ?? group, league: sportTitle };
}

const PALETTE = ['#2a6bff', '#e5484d', '#12a594', '#f5a524', '#8e4ec6', '#0090ff', '#e54666', '#30a46c', '#d6409f', '#ffb224'];
export function teamColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export const initials = (name: string) =>
  name
    .replace(/FC|CF|AFC|SC/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

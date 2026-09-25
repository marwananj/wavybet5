export const usd = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const odds = (v: number | string) => Number(v).toFixed(2);

export const MARKET_LABEL: Record<string, string> = {
  h2h: 'Match result',
  totals: 'Total goals',
  btts: 'Both teams to score',
  double_chance: 'Double chance',
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

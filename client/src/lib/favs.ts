import { useEffect, useState } from 'react';

/**
 * Favourite matches (and casino games) stored in this browser.
 * Starred matches get goal alerts and appear under "My matches".
 */
const KEYS = { events: 'wb_fav_events', games: 'wb_fav_games' } as const;
type Kind = keyof typeof KEYS;
const cache: Record<Kind, Set<string>> = { events: new Set(), games: new Set() };
const subs = new Set<() => void>();

for (const k of Object.keys(KEYS) as Kind[]) {
  try {
    cache[k] = new Set(JSON.parse(localStorage.getItem(KEYS[k]) ?? '[]'));
  } catch {
    /* private mode */
  }
}

export const isFav = (kind: Kind, id: string) => cache[kind].has(id);
export const favList = (kind: Kind) => [...cache[kind]];

export function toggleFav(kind: Kind, id: string) {
  const s = cache[kind];
  if (s.has(id)) s.delete(id);
  else s.add(id);
  // keep it small
  while (s.size > 60) s.delete(s.values().next().value!);
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
  return s.has(id);
}

export function useFavs(kind: Kind) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return { list: favList(kind), has: (id: string) => cache[kind].has(id), toggle: (id: string) => toggleFav(kind, id) };
}

/* recently played casino games */
const RECENT = 'wb_recent_games';
export function pushRecentGame(id: string) {
  try {
    const cur: string[] = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    localStorage.setItem(RECENT, JSON.stringify([id, ...cur.filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* ignore */
  }
}
export function recentGames(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
}

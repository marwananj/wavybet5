import { useEffect, useRef } from 'react';
import { BASE } from './api';
import type { SportEvent } from './types';

/**
 * One shared Server-Sent Events connection for the whole app.
 * The server pushes fresh events (odds, score, minute, locks) the moment it receives them from the API.
 */
type Listener = (events: SportEvent[]) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource(`${BASE}/api/live/stream`, { withCredentials: true });
  es.addEventListener('events', (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data) as { events: SportEvent[] };
      listeners.forEach((l) => l(d.events));
    } catch {
      /* ignore malformed frame */
    }
  });
  for (const name of ['chat', 'support']) {
    es.addEventListener(name, (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        named.get(name)?.forEach((l) => l(d));
      } catch {
        /* ignore */
      }
    });
  }
  // EventSource reconnects by itself (server sends retry: 3000)
}

/* other named pushes on the same connection (chat messages, support hints) */
type NamedListener = (data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const named = new Map<string, Set<NamedListener>>();
export function subscribeNamed(name: 'chat' | 'support', fn: NamedListener) {
  if (!named.has(name)) named.set(name, new Set());
  named.get(name)!.add(fn);
  // reuse the shared connection lifecycle
  const off = subscribeLive(() => {});
  return () => {
    named.get(name)!.delete(fn);
    off();
  };
}

export function subscribeLive(fn: Listener) {
  listeners.add(fn);
  if (closeTimer) clearTimeout(closeTimer);
  connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      // keep the connection briefly in case another page subscribes right away (navigation)
      closeTimer = setTimeout(() => {
        if (!listeners.size) {
          es?.close();
          es = null;
        }
      }, 5000);
    }
  };
}

/** React hook: call `fn` with every pushed batch of events. */
export function useLiveUpdates(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribeLive((evs) => ref.current?.(evs)), []);
}

/** Merge pushed events into a list. With `liveList`, events that go live are added and finished ones removed. */
export function mergeEvents(list: SportEvent[] | null, incoming: SportEvent[], liveList = false): SportEvent[] | null {
  if (!list) return list;
  const map = new Map(incoming.map((e) => [e.id, e]));
  let out = list.map((e) => map.get(e.id) ?? e);
  if (liveList) {
    const have = new Set(out.map((e) => e.id));
    out = out.filter((e) => e.status === 'LIVE');
    for (const e of incoming) if (e.status === 'LIVE' && !have.has(e.id)) out.push(e);
  }
  return out;
}

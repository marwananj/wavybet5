import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from './api';
import { getOddsFormat, setOddsFormat } from './format';
import { useLiveUpdates } from './live';
import type { Pick, SportEvent, Outcome, User } from './types';

const ERR_KEY = 'wb_verify_err';
/** register() stores the reason when the first e-mail could not be sent */
export const rememberVerifyError = (msg: string | null) => {
  try {
    if (msg) sessionStorage.setItem(ERR_KEY, msg);
    else sessionStorage.removeItem(ERR_KEY);
  } catch {
    /* ignore */
  }
};
export const takeVerifyError = () => {
  try {
    const m = sessionStorage.getItem(ERR_KEY);
    sessionStorage.removeItem(ERR_KEY);
    return m;
  } catch {
    return null;
  }
};


/* --------------------------------- Toasts -------------------------------- */

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------------------------- Auth --------------------------------- */

interface AuthState {
  user: User | null;
  ready: boolean;
  modal: null | 'login' | 'register' | 'verify';
  openAuth: (m: 'login' | 'register' | 'verify' | null) => void;
  login: (login: string, password: string) => Promise<void>;
  register: (data: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  setBalance: (b: string) => void;
  reloadUser: () => Promise<void>;
}
const AuthCtx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // the account's odds format wins once the player is known
  useEffect(() => {
    if (user?.oddsFormat && user.oddsFormat !== getOddsFormat()) {
      setOddsFormat(user.oddsFormat);
      window.dispatchEvent(new Event('wb-odds'));
    }
  }, [user?.oddsFormat]);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<AuthState['modal']>(null);

  useEffect(() => {
    const onUser = (e: Event) => setUser((e as CustomEvent).detail);
    window.addEventListener('wb:user', onUser);
    setSessionLostHandler(() => setUser(null));
    refreshSession().finally(() => setReady(true));
    return () => window.removeEventListener('wb:user', onUser);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      modal,
      openAuth: setModal,
      async login(login, password) {
        const d = await api<{ accessToken: string; user: User }>('/auth/login', { body: { login, password } });
        setAccessToken(d.accessToken);
        setUser(d.user);
        setModal(null);
      },
      async register(data) {
        let ref: string | null = null;
        try {
          ref = localStorage.getItem('wb_ref');
        } catch {
          /* ignore */
        }
        const d = await api<{ accessToken: string; user: User; emailError?: string | null }>('/auth/register', { body: ref && !data.ref ? { ...data, ref } : data });
        rememberVerifyError(d.emailError ?? null);
        setAccessToken(d.accessToken);
        setUser(d.user);
        // new accounts confirm their e-mail with a 6-digit code before playing
        setModal(null); // unverified players see the full-screen code page (VerifyGate)
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        setAccessToken(null);
        setUser(null);
      },
      setUser,
      setBalance: (b) => setUser((u) => (u ? { ...u, balance: b } : u)),
      async reloadUser() {
        const d = await api<{ user: User }>('/auth/me');
        setUser(d.user);
      },
    }),
    [user, ready, modal]
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* -------------------------------- Betslip -------------------------------- */

interface SlipState {
  picks: Pick[];
  open: boolean;
  setOpen: (o: boolean) => void;
  toggle: (ev: SportEvent, marketKey: string, o: Outcome) => void;
  has: (outcomeId: string) => boolean;
  remove: (outcomeId: string) => void;
  clear: () => void;
  update: (outcomeId: string, patch: Partial<Pick>) => void;
  replaceAll: (p: Pick[]) => void;
  /** Quick Bet: tapping odds places a single straight away */
  quick: { on: boolean; stake: number };
  setQuick: (q: { on: boolean; stake: number }) => void;
  quickBusy: string | null;
  quickPlace: (ev: SportEvent, marketKey: string, o: Outcome) => void;
}
const SlipCtx = createContext<SlipState>(null as unknown as SlipState);
export const useSlip = () => useContext(SlipCtx);

const SLIP_KEY = 'wb_slip_v1';

// invite links (?ref=CODE) are remembered until the visitor registers
if (typeof window !== 'undefined') {
  try {
    const u = new URL(window.location.href);
    const ref = u.searchParams.get('ref');
    if (ref && /^[A-Za-z0-9]{3,32}$/.test(ref)) {
      localStorage.setItem('wb_ref', ref.toUpperCase());
      u.searchParams.delete('ref');
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    }
  } catch {
    /* ignore */
  }
}
export function SlipProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<Pick[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(SLIP_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [quick, setQuickState] = useState<{ on: boolean; stake: number }>(() => {
    try {
      return JSON.parse(localStorage.getItem('wb_quickbet') ?? '') as { on: boolean; stake: number };
    } catch {
      return { on: false, stake: 5 };
    }
  });
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const setQuick = (q: { on: boolean; stake: number }) => {
    setQuickState(q);
    try {
      localStorage.setItem('wb_quickbet', JSON.stringify(q));
    } catch {
      /* ignore */
    }
  };
  const quickPlace = async (ev: SportEvent, marketKey: string, o: Outcome) => {
    if (!user) return openAuth('login');
    if (quickBusy) return;
    if (!(quick.stake > 0)) return toast('err', 'Set a Quick Bet stake first');
    if (quick.stake > Number(user.balance)) return toast('err', 'Insufficient balance for Quick Bet');
    setQuickBusy(o.id);
    try {
      const d = await api<{ balance: string }>('/bets', {
        body: { mode: 'singles', acceptOddsChanges: 'higher', selections: [{ outcomeId: o.id, odds: o.price, stake: quick.stake }] },
      });
      setBalance(d.balance);
      toast('ok', `⚡ Quick bet: $${quick.stake.toFixed(2)} on ${o.name} @ ${o.price.toFixed(2)} (${ev.homeTeam} v ${ev.awayTeam})`);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (err.code === 'EMAIL_UNVERIFIED') openAuth('verify');
      toast('err', err.message ?? 'Quick bet failed');
    } finally {
      setQuickBusy(null);
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(SLIP_KEY, JSON.stringify(picks));
    } catch {
      /* private mode */
    }
  }, [picks]);

  // instant price / lock updates for picks in the slip
  useLiveUpdates((incoming) => {
    const byEvent = new Map(incoming.map((e) => [e.id, e]));
    setPicks((ps) => {
      if (!ps.some((p) => byEvent.has(p.eventId))) return ps;
      return ps.map((p) => {
        const ev = byEvent.get(p.eventId);
        if (!ev) return p;
        let found: { price: number; open: boolean } | null = null;
        for (const m of ev.markets) {
          const o = m.outcomes.find((x) => x.id === p.outcomeId);
          if (o) found = { price: o.price, open: !!ev.bettingOpen && !m.suspended && !o.suspended };
        }
        const live = ev.status === 'LIVE';
        // pushes carry only the 1X2 market; other picks are refreshed by the /outcomes poll below
        if (!found) return ev.bettingOpen === false ? { ...p, unavailable: true, live } : { ...p, live };
        if (!found.open) return { ...p, unavailable: true, live };
        return found.price !== p.odds ? { ...p, prevOdds: p.odds, odds: found.price, unavailable: false, live } : { ...p, unavailable: false, live };
      });
    });
  });

  // keep prices fresh while the slip has picks (safety net)
  useEffect(() => {
    if (!picks.length) return;
    const tick = async () => {
      try {
        const d = await api<{ outcomes: { id: string; price: number; available: boolean; live: boolean }[] }>('/outcomes', { body: { ids: picks.map((p) => p.outcomeId) } });
        const m = new Map(d.outcomes.map((o) => [o.id, o]));
        setPicks((ps) =>
          ps.map((p) => {
            const o = m.get(p.outcomeId);
            if (!o || !o.available) return { ...p, unavailable: true, live: o?.live ?? p.live };
            return o.price !== p.odds ? { ...p, prevOdds: p.odds, odds: o.price, unavailable: false, live: o.live } : { ...p, unavailable: false, live: o.live };
          })
        );
      } catch {
        /* offline */
      }
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [picks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<SlipState>(
    () => ({
      picks,
      open,
      setOpen,
      has: (id) => picks.some((p) => p.outcomeId === id),
      toggle(ev, marketKey, o) {
        setPicks((ps) => {
          if (ps.some((p) => p.outcomeId === o.id)) return ps.filter((p) => p.outcomeId !== o.id);
          if (ps.length >= 15) return ps;
          return [
            ...ps,
            {
              outcomeId: o.id,
              eventId: ev.id,
              eventLabel: `${ev.homeTeam} vs ${ev.awayTeam}`,
              sportTitle: ev.sportTitle,
              marketKey,
              outcomeName: o.name,
              odds: o.price,
            },
          ];
        });
      },
      remove: (id) => setPicks((ps) => ps.filter((p) => p.outcomeId !== id)),
      clear: () => setPicks([]),
      update: (id, patch) => setPicks((ps) => ps.map((p) => (p.outcomeId === id ? { ...p, ...patch } : p))),
      replaceAll: setPicks,
      quick,
      setQuick,
      quickBusy,
      quickPlace,
    }),
    [picks, open, quick, quickBusy, user?.id, user?.balance] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <SlipCtx.Provider value={value}>{children}</SlipCtx.Provider>;
}

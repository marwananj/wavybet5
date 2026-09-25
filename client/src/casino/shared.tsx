import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { LuShieldCheck, LuChevronLeft, LuRefreshCw, LuVolume2, LuVolumeX } from 'react-icons/lu';
import { ApiError } from '../lib/api';
import { dateTime, usd } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import { Modal, Spinner } from '../components/ui';
import { casino, loadCasinoConfig, mult, RANKS, SUITS, type Card, type CasinoConfig, type Round } from './api';
import { GAMES } from './meta';
import { sfx, useMuted } from './sound';

/* ------------------------------ hooks ------------------------------- */

export function useCasinoConfig() {
  const [c, setC] = useState<CasinoConfig | null>(null);
  useEffect(() => {
    loadCasinoConfig().then(setC).catch(() => {});
  }, []);
  return c;
}

/** Shared bet plumbing: login gate, optimistic balance, error toasts. */
export function useBet() {
  const { user, openAuth, setBalance, reloadUser } = useAuth();
  const toast = useToast();
  return {
    user,
    /** returns false (and opens login) when not signed in */
    ensure(stake?: number) {
      if (!user) {
        openAuth('login');
        return false;
      }
      if (stake != null && stake > Number(user.balance)) {
        toast('err', 'Insufficient balance — deposit to play');
        return false;
      }
      return true;
    },
    debit(stake: number) {
      if (user) setBalance(String(Math.max(0, Number(user.balance) - stake)));
    },
    setBalance,
    fail(e: unknown) {
      toast('err', (e as ApiError).message ?? 'Something went wrong');
      reloadUser().catch(() => {}); // undo the optimistic debit
    },
    toast,
  };
}

/* ------------------------------ layout ------------------------------ */

export function GameShell({
  game,
  controls,
  stage,
  refreshKey,
  className = '',
}: {
  game: string;
  controls: ReactNode;
  stage: ReactNode;
  refreshKey?: number;
  className?: string;
}) {
  const meta = GAMES.find((g) => g.id === game)!;
  const [fair, setFair] = useState(false);
  const [muted, setMuted] = useMuted();
  return (
    <div className={`page casino-page g-${game} ${className}`}>
      <div className="game-head">
        <Link to="/casino" className="icon-btn" aria-label="Back to Originals" >
          <LuChevronLeft size={20} />
        </Link>
        <div className="game-title">
          <span className="gt-kicker">Wavy Originals</span>
          <h1>{meta.name}</h1>
        </div>
        <button
          className={`icon-btn sound-btn ${muted ? 'off' : ''}`}
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          title={muted ? 'Sound off' : 'Sound on'}
          onClick={() => {
            setMuted(!muted);
            if (muted) setTimeout(() => sfx.click(), 30);
          }}
        >
          {muted ? <LuVolumeX size={18} /> : <LuVolume2 size={18} />}
        </button>
        <button className="btn btn-ghost btn-sm fair-btn" onClick={() => setFair(true)}>
          <LuShieldCheck size={16} /> Fairness
        </button>
      </div>
      <div className="game-shell">
        <aside className="game-controls">{controls}</aside>
        <section className="game-stage">{stage}</section>
      </div>
      <RecentRounds game={game} refreshKey={refreshKey} />
      <OtherGames current={game} />
      {fair && <FairnessModal onClose={() => setFair(false)} />}
    </div>
  );
}

export function BetAmount({ value, onChange, disabled, label = 'Bet amount' }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) {
  const { user } = useAuth();
  const n = Number(value) || 0;
  const set = (x: number) => onChange((Math.floor(Math.max(0, x) * 100) / 100).toFixed(2));
  return (
    <label className="field bet-amount">
      <span>{label}</span>
      <div className="amount-input">
        <b>$</b>
        <input inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={() => set(n)} />
        <button type="button" className="mini-btn" disabled={disabled} onClick={() => (sfx.chip(), set(n / 2))}>
          ½
        </button>
        <button type="button" className="mini-btn" disabled={disabled} onClick={() => (sfx.chip(), set(n * 2))}>
          2×
        </button>
        {user && (
          <button type="button" className="mini-btn" disabled={disabled} onClick={() => (sfx.chip(), set(Number(user.balance)))}>
            Max
          </button>
        )}
      </div>
    </label>
  );
}

export function InfoRow({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <b className={accent ? 'win' : ''}>{value}</b>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="seg seg-sm">
      {options.map((o) => (
        <button key={o.v} type="button" className={value === o.v ? 'on' : ''} onClick={() => (sfx.click(), onChange(o.v))} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlayButton({ children, busy, disabled, onClick, tone = 'primary' }: { children: ReactNode; busy?: boolean; disabled?: boolean; onClick: () => void; tone?: 'primary' | 'cash' }) {
  return (
    <button type="button" className={`btn btn-block play-btn ${tone === 'cash' ? 'btn-cash' : 'btn-primary'}`} disabled={disabled || busy} onClick={onClick}>
      {busy ? <Spinner /> : children}
    </button>
  );
}

/** Big win/lose banner that pops over the stage. */
export function ResultPop({ show, win, multiplier, payout, label }: { show: boolean; win: boolean; multiplier?: number; payout?: string | number; label?: string }) {
  if (!show) return null;
  return (
    <div className={`result-pop ${win ? 'rp-win' : 'rp-lose'}`}>
      {win ? (
        <>
          <b>{multiplier != null ? mult(multiplier) : 'WIN'}</b>
          {payout != null && <span>{usd(payout)}</span>}
        </>
      ) : (
        <b>{label ?? 'No win'}</b>
      )}
    </div>
  );
}

/* ---------------------------- playing card --------------------------- */

export function PlayingCard({ card, faceDown, style, className = '', small }: { card?: Card | null; faceDown?: boolean; style?: CSSProperties; className?: string; small?: boolean }) {
  const red = card && (card.suit === 1 || card.suit === 2);
  return (
    <div className={`pcard${faceDown || !card ? ' down' : ''}${small ? ' small' : ''} ${className}`} style={style}>
      <div className="pcard-inner">
        <div className={`pcard-face${red ? ' red' : ''}`}>
          {card && (
            <>
              <span className="pc-corner">
                {RANKS[card.rank]}
                <i>{SUITS[card.suit]}</i>
              </span>
              <span className="pc-suit">{SUITS[card.suit]}</span>
              <span className="pc-corner pc-bottom">
                {RANKS[card.rank]}
                <i>{SUITS[card.suit]}</i>
              </span>
            </>
          )}
        </div>
        <div className="pcard-back">
          <svg viewBox="0 0 64 40" aria-hidden>
            <path d="M4 26c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#3ad0ff" strokeWidth="6" strokeLinecap="round" />
            <path d="M4 14c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ fairness ----------------------------- */

export function FairnessModal({ onClose }: { onClose: () => void }) {
  const { user, openAuth } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<Awaited<ReturnType<typeof casino.fair>> | null>(null);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => casino.fair().then((x) => (setD(x), setSeed(x.clientSeed)));
  useEffect(() => {
    if (user) load().catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const rotate = async () => {
    setBusy(true);
    try {
      await casino.rotate(seed);
      await load();
      toast('ok', 'New seed pair active — previous server seed revealed');
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} title="Provably fair">
      <div className="fair-body">
        <p className="muted">
          Every result is calculated from <b>HMAC_SHA256(server seed, "client seed:nonce:round")</b>. You see the SHA-256 hash of the server seed before you play; rotating your seed reveals the old server seed so you can verify every past bet.
        </p>
        {!user ? (
          <button className="btn btn-primary" onClick={() => openAuth('login')}>
            Log in to see your seeds
          </button>
        ) : !d ? (
          <Spinner />
        ) : (
          <>
            <label className="field">
              <span>Active server seed (SHA-256)</span>
              <code className="seed">{d.serverSeedHash}</code>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Client seed</span>
                <input value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={64} />
              </label>
              <label className="field">
                <span>Nonce (bets made)</span>
                <input value={d.nonce} readOnly />
              </label>
            </div>
            <button className="btn btn-primary btn-block" onClick={rotate} disabled={busy}>
              {busy ? <Spinner /> : (
                <>
                  <LuRefreshCw size={16} /> Change seeds
                </>
              )}
            </button>
            {d.previous && (
              <div className="prev-seed">
                <h4>Previous seed pair (revealed)</h4>
                <label className="field">
                  <span>Server seed</span>
                  <code className="seed">{d.previous.serverSeed}</code>
                </label>
                <label className="field">
                  <span>Hash</span>
                  <code className="seed">{d.previous.serverSeedHash}</code>
                </label>
                <small className="muted">
                  Client seed <b>{d.previous.clientSeed}</b> · nonces 0–{Math.max(0, d.previous.nonce - 1)}
                </small>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------- recent rounds -------------------------- */

const STATUS: Record<string, string> = { WON: 'Win', LOST: 'Loss', PUSH: 'Push', CASHED: 'Cashed out' };

export function RecentRounds({ game, refreshKey }: { game: string; refreshKey?: number }) {
  const { user } = useAuth();
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [open, setOpen] = useState<Round | null>(null);
  useEffect(() => {
    if (!user) return setRounds(null);
    const t = setTimeout(() => casino.rounds(game).then((d) => setRounds(d.rounds)).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [game, refreshKey, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user || !rounds?.length) return null;
  return (
    <section className="recent-rounds">
      <h3>My recent bets</h3>
      <div className="table-wrap">
        <table className="table rr-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Bet</th>
              <th>Multiplier</th>
              <th>Payout</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const won = Number(r.payout) > Number(r.stake);
              return (
                <tr key={r.id} onClick={() => setOpen(r)} className="clickable">
                  <td>{dateTime(r.createdAt)}</td>
                  <td>{usd(r.stake)}</td>
                  <td>{mult(r.multiplier)}</td>
                  <td className={won ? 'win' : Number(r.payout) === 0 ? 'loss' : ''}>{Number(r.payout) > 0 ? `+${usd(r.payout)}` : `-${usd(r.stake)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal onClose={() => setOpen(null)} title={`Bet ${open.id.slice(-8).toUpperCase()}`}>
          <div className="fair-body">
            <div className="info-grid">
              <InfoRow label="Result" value={STATUS[open.status] ?? open.status} />
              <InfoRow label="Bet" value={usd(open.stake)} />
              <InfoRow label="Multiplier" value={mult(open.multiplier)} />
              <InfoRow label="Payout" value={usd(open.payout)} accent={Number(open.payout) > Number(open.stake)} />
            </div>
            <label className="field">
              <span>Server seed hash</span>
              <code className="seed">{open.fair.serverSeedHash}</code>
            </label>
            <label className="field">
              <span>Server seed</span>
              <code className="seed">{open.fair.serverSeed ?? 'Hidden until you change your seed pair'}</code>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Client seed</span>
                <code className="seed">{open.fair.clientSeed}</code>
              </label>
              <label className="field">
                <span>Nonce</span>
                <code className="seed">{open.fair.nonce}</code>
              </label>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function OtherGames({ current }: { current: string }) {
  const { navigate } = useRouter();
  return (
    <section className="other-games">
      <h3>More Wavy Originals</h3>
      <div className="og-row">
        {GAMES.filter((g) => g.id !== current).map((g) => (
          <button key={g.id} className="og-chip" style={{ '--c1': g.c1, '--c2': g.c2 } as CSSProperties} onClick={() => navigate(g.path)}>
            <g.Icon size={18} />
            {g.name}
          </button>
        ))}
      </div>
    </section>
  );
}

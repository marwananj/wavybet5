import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usd } from '../../lib/format';
import { casino, type Round } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, useBet, useCasinoConfig } from '../shared';
import { explosion, fuseLoop, sfx } from '../sound';

interface BombView {
  elapsed: number;
  rate: number;
  auto: number | null;
  finished: boolean;
  exploded: boolean;
  cashedAt: number | null;
  multiplier: number;
  crash: number | null;
}

const at = (ms: number, rate: number) => Math.floor(Math.exp((rate * Math.max(0, ms)) / 1000) * 100) / 100;
const fmt = (m: number) => (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2));

type Phase = 'idle' | 'lit' | 'boom' | 'cashed';
const FUSE = 'M60 112 C 58 80, 92 78, 88 50 C 85 28, 104 22, 110 8';

/** Spark particles that fly off the burning fuse tip */
function Sparks({ n = 14 }: { n?: number }) {
  return (
    <span className="bm-sparks" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ '--a': `${(i * 360) / n + Math.random() * 20}deg`, '--d': `${0.35 + Math.random() * 0.5}s`, '--r': `${18 + Math.random() * 26}px` } as CSSProperties} />
      ))}
    </span>
  );
}

/** Shockwave + debris for the explosion */
function Blast() {
  return (
    <div className="bm-blast" aria-hidden>
      <span className="bm-flash" />
      <span className="bm-ring" />
      <span className="bm-ring r2" />
      <span className="bm-fire" />
      {Array.from({ length: 22 }, (_, i) => (
        <i key={i} className="bm-debris" style={{ '--a': `${(i * 360) / 22 + Math.random() * 12}deg`, '--r': `${120 + Math.random() * 160}px`, '--s': `${4 + Math.random() * 9}px`, '--rot': `${Math.random() * 720 - 360}deg` } as CSSProperties} />
      ))}
    </div>
  );
}

export function BombGame() {
  const bet = useBet();
  const cfg = useCasinoConfig();
  const rate = cfg?.bomb?.rate ?? 0.12;
  const [amount, setAmount] = useState('1.00');
  const [autoOn, setAutoOn] = useState(false);
  const [auto, setAuto] = useState('2.00');
  const [round, setRound] = useState<Round<BombView> | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState(1);
  const [history, setHistory] = useState<{ x: number; id: number; win: boolean }[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [shake, setShake] = useState(0);

  const clock = useRef<{ t0: number; offset: number } | null>(null); // local start for the animation
  const req = useRef<Promise<unknown> | null>(null); // one request at a time (server uses versioning)
  const fuse = useRef<ReturnType<typeof fuseLoop> | null>(null);
  const roundRef = useRef<Round<BombView> | null>(null);
  roundRef.current = round;

  const stake = Number(amount) || 0;
  const autoN = autoOn ? Number(auto) || 0 : 0;

  /* finish (from any response) */
  const finish = (r: Round<BombView>, balance?: string) => {
    const v = r.view!;
    clock.current = null;
    fuse.current?.stop();
    fuse.current = null;
    if (balance) bet.setBalance(balance);
    setRound(r);
    setRefresh((x) => x + 1);
    if (v.exploded) {
      setM(v.crash ?? v.multiplier);
      setPhase('boom');
      setShake((s) => s + 1);
      explosion();
      setHistory((h) => [{ x: v.crash ?? 1, id: Date.now(), win: false }, ...h].slice(0, 14));
    } else {
      setM(v.cashedAt ?? v.multiplier);
      setPhase('cashed');
      sfx.cashout();
      if ((v.cashedAt ?? 0) >= 10) setTimeout(() => sfx.bigWin(), 300);
      setHistory((h) => [{ x: v.crash ?? v.cashedAt ?? 1, id: Date.now(), win: true }, ...h].slice(0, 14));
    }
  };

  const send = (action: 'tick' | 'cashout') => {
    const r = roundRef.current;
    if (!r || r.view?.finished) return Promise.resolve();
    const run = async () => {
      const cur = roundRef.current;
      if (!cur || cur.view?.finished || !clock.current) return;
      try {
        const d = await casino.act<BombView>('bomb', cur.id, action);
        if (d.round.view?.finished) finish(d.round, d.balance);
        else setRound(d.round);
      } catch (e) {
        if (action === 'cashout') bet.fail(e);
      }
    };
    const p = (req.current ?? Promise.resolve()).then(run, run);
    req.current = p;
    return p;
  };

  /* animation + server heartbeat */
  useEffect(() => {
    if (phase !== 'lit') return;
    let raf = 0;
    let lastPoll = 0;
    let autoFired = false;
    const loop = (now: number) => {
      const c = clock.current;
      if (!c) return;
      const ms = now - c.t0 + c.offset;
      const x = at(ms, rate);
      setM(x);
      fuse.current?.set(Math.min(1, Math.log(x) / Math.log(20)));
      const v = roundRef.current?.view;
      if (v?.auto && x >= v.auto && !autoFired) {
        autoFired = true;
        send('tick');
      }
      if (now - lastPoll > 450) {
        lastPoll = now;
        send('tick');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* resume a bomb that is still burning (page reload) */
  useEffect(() => {
    if (!bet.user) return;
    casino
      .active<BombView>('bomb')
      .then((d) => {
        if (!d.round?.view || d.round.view.finished) return;
        setRound(d.round);
        clock.current = { t0: performance.now(), offset: d.round.view.elapsed };
        fuse.current = fuseLoop();
        setPhase('lit');
      })
      .catch(() => {});
    return () => fuse.current?.stop();
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function light() {
    if (!bet.ensure(stake)) return;
    if (autoOn && !(autoN >= 1.01)) return bet.toast('err', 'Auto cash-out must be at least 1.01×');
    setBusy(true);
    bet.debit(stake);
    sfx.bet();
    try {
      const d = await casino.start<BombView>('bomb', { stake, auto: autoOn ? autoN : null });
      bet.setBalance(d.balance);
      const v = d.round.view!;
      req.current = null;
      if (v.finished) {
        clock.current = { t0: performance.now(), offset: 0 };
        finish(d.round);
        return;
      }
      setRound(d.round);
      setM(1);
      clock.current = { t0: performance.now(), offset: v.elapsed };
      sfx.whoosh(0.5);
      fuse.current?.stop();
      fuse.current = fuseLoop();
      setPhase('lit');
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const cashout = () => {
    sfx.click();
    send('cashout');
  };

  const v = round?.view;
  const lit = phase === 'lit';
  const progress = Math.min(0.96, Math.log(Math.max(1, m)) / Math.log(60)); // fuse burnt
  const heat = Math.min(1, Math.log(Math.max(1, m)) / Math.log(15));
  const won = phase === 'cashed' && v ? Number(round!.payout) : 0;
  const stakeNow = round ? Number(round.stake) : stake;

  return (
    <GameShell
      game="bomb"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || lit} />
          <label className="bm-auto">
            <span>
              <input type="checkbox" checked={autoOn} disabled={lit} onChange={(e) => setAutoOn(e.target.checked)} /> Auto cash-out at
            </span>
            <div className="amount-input">
              <input inputMode="decimal" value={auto} disabled={!autoOn || lit} onChange={(e) => setAuto(e.target.value.replace(/[^0-9.]/g, ''))} />
              <b>×</b>
            </div>
          </label>
          <InfoRow label={lit ? 'Cash out now' : autoOn ? 'Profit at auto cash-out' : 'Win chance at 2×'} value={lit ? usd(stakeNow * m) : autoOn ? usd(stake * autoN - stake) : '49.5%'} accent />
          <ActionBar>
            {lit ? (
              <PlayButton tone="cash" onClick={cashout}>
                Cash out {usd(stakeNow * m)}
              </PlayButton>
            ) : (
              <PlayButton busy={busy} onClick={light}>
                {phase === 'idle' ? 'Light the fuse' : 'Light a new bomb'} · {usd(stake)}
              </PlayButton>
            )}
          </ActionBar>
          <small className="muted">
            The multiplier climbs while the fuse burns. Cash out before the bomb explodes — the blast point is fixed when you light it (provably fair, 99% RTP).
          </small>
        </>
      }
      stage={
        <div className={`bomb-stage ${phase}`} key={`shake${shake}`} style={{ '--heat': heat } as CSSProperties}>
          <div className="bm-history">
            {history.map((h) => (
              <span key={h.id} className={`bm-pill ${h.x >= 2 ? 'hi' : ''} ${h.win ? 'win' : ''}`}>
                {fmt(h.x)}×
              </span>
            ))}
          </div>
          <div className="bm-room" aria-hidden>
            <div className="bm-floor" />
            <div className="bm-glow" />
          </div>

          <div className={`bm-mult ${phase}`}>
            <b>{fmt(m)}×</b>
            <span>
              {phase === 'idle' && 'Light the fuse'}
              {phase === 'lit' && (v?.auto ? `Auto cash-out at ${v.auto.toFixed(2)}×` : 'Cash out before it blows!')}
              {phase === 'boom' && `BOOM! Exploded at ${fmt(v?.crash ?? m)}×`}
              {phase === 'cashed' && `You won ${usd(won)} · bomb would explode at ${fmt(v?.crash ?? m)}×`}
            </span>
          </div>

          <div className="bm-scene">
            <div className={`bm-bomb ${phase}`} style={{ '--p': progress } as CSSProperties}>
              <div className="bm-shadow" />
              <div className="bm-body">
                <span className="bm-shine" />
                <span className="bm-cracks" />
                <span className="bm-logo">
                  <svg viewBox="0 0 64 40">
                    <path d="M4 26c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#3ad0ff" strokeWidth="6" strokeLinecap="round" />
                    <path d="M4 14c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="bm-band" />
              </div>
              <div className="bm-cap">
                <i />
              </div>
              <div className="bm-fusebox">
                <svg className="bm-fuse" viewBox="0 0 120 120" width="120" height="120" aria-hidden>
                  <path className="bm-fuse-shadow" d={FUSE} pathLength={100} style={{ strokeDasharray: `${(1 - progress) * 100} 200` }} />
                  <path className="bm-fuse-rope" d={FUSE} pathLength={100} style={{ strokeDasharray: `${(1 - progress) * 100} 200` }} />
                </svg>
                {(lit || phase === 'idle') && (
                  <span className={`bm-tip ${lit ? 'on' : ''}`} style={{ offsetPath: `path('${FUSE}')`, offsetDistance: `${(1 - progress) * 100}%` } as CSSProperties}>
                    {lit && (
                      <>
                        <span className="bm-flame" />
                        <Sparks />
                      </>
                    )}
                  </span>
                )}
              </div>
              {phase === 'cashed' && <span className="bm-smoke" />}
            </div>
            {phase === 'boom' && <Blast />}
          </div>
        </div>
      }
    />
  );
}

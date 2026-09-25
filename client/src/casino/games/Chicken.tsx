import { useEffect, useRef, useState } from 'react';
import { usd } from '../../lib/format';
import { casino, mult, type Round } from '../api';
import { ChickenSprite } from '../Posters';
import { BetAmount, GameShell, InfoRow, PlayButton, Seg, useBet, useCasinoConfig } from '../shared';
import { resultSound, sfx } from '../sound';

type Level = 'easy' | 'medium' | 'hard' | 'expert';
interface ChickenView {
  level: Level;
  lane: number;
  lanes: number;
  ladder: number[];
  multiplier: number;
  finished: boolean;
  dead: boolean;
  cars?: boolean[];
  canCashout: boolean;
  cashed: boolean;
}
const LANE_W = 96;
const CURB_W = 110;

function Car({ tone }: { tone: number }) {
  const colors = ['#ff4d6d', '#3b82ff', '#ffb020', '#16c79a', '#a855f7'];
  const c = colors[tone % colors.length];
  return (
    <svg viewBox="0 0 60 100" className="car-svg" aria-hidden>
      <rect x="6" y="4" width="48" height="92" rx="14" fill={c} />
      <rect x="12" y="20" width="36" height="18" rx="5" fill="#0b1020" opacity=".85" />
      <rect x="12" y="66" width="36" height="14" rx="5" fill="#0b1020" opacity=".7" />
      <rect x="8" y="6" width="10" height="5" rx="2" fill="#fff6c4" />
      <rect x="42" y="6" width="10" height="5" rx="2" fill="#fff6c4" />
      <rect x="2" y="26" width="5" height="14" rx="2" fill="#111" />
      <rect x="53" y="26" width="5" height="14" rx="2" fill="#111" />
      <rect x="2" y="64" width="5" height="14" rx="2" fill="#111" />
      <rect x="53" y="64" width="5" height="14" rx="2" fill="#111" />
    </svg>
  );
}

export function ChickenGame() {
  const bet = useBet();
  const cfg = useCasinoConfig();
  const [amount, setAmount] = useState('1.00');
  const [level, setLevel] = useState<Level>('medium');
  const [round, setRound] = useState<Round<ChickenView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [hop, setHop] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const road = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bet.user) return;
    casino
      .active<ChickenView>('chicken')
      .then((d) => {
        if (d.round) {
          setRound(d.round);
          setLevel(d.round.view!.level);
        }
      })
      .catch(() => {});
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = round?.view;
  const inPlay = !!v && !v.finished;
  const ladder = v?.ladder ?? cfg?.chicken[level]?.ladder ?? [];
  const lane = v?.lane ?? 0;
  const stake = round ? Number(round.stake) : Number(amount) || 0;
  // the lane the chicken is standing in (dead chicken stands in the lane it tried to cross)
  const pos = v?.dead ? lane + 1 : lane;

  useEffect(() => {
    const el = road.current;
    if (!el) return;
    const x = CURB_W + pos * LANE_W - el.clientWidth / 3;
    el.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
  }, [pos, level]);

  async function start() {
    const s = Number(amount) || 0;
    if (!bet.ensure(s)) return;
    setBusy(true);
    bet.debit(s);
    try {
      sfx.bet();
      const d = await casino.start<ChickenView>('chicken', { stake: s, level });
      setRound(d.round);
      bet.setBalance(d.balance);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: 'step' | 'cashout') {
    if (!round) return;
    setBusy(true);
    try {
      const d = await casino.act<ChickenView>('chicken', round.id, action);
      if (action === 'step') {
        setHop((h) => h + 1);
        sfx.hop();
        if (d.round.view?.dead) setTimeout(() => sfx.crash(), 250);
        else if (d.round.view?.finished) setTimeout(() => sfx.bigWin(), 300);
        else setTimeout(() => sfx.step(Math.min(12, d.round.view?.lane ?? 0)), 220);
      } else sfx.cashout();
      setRound(d.round);
      bet.setBalance(d.balance);
      if (d.round.view?.finished) setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const nextMult = ladder[lane] ?? null;

  return (
    <GameShell
      game="chicken"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || inPlay} />
          <span className="field-label">Difficulty</span>
          <Seg
            value={level}
            onChange={(x) => (setLevel(x), !inPlay && setRound(null))}
            disabled={busy || inPlay}
            options={[
              { v: 'easy', label: 'Easy' },
              { v: 'medium', label: 'Medium' },
              { v: 'hard', label: 'Hard' },
              { v: 'expert', label: 'Expert' },
            ]}
          />
          {inPlay ? (
            <>
              <PlayButton busy={busy} onClick={() => act('step')}>
                Go {nextMult ? `→ ${mult(nextMult)}` : ''}
              </PlayButton>
              <PlayButton tone="cash" busy={busy} disabled={!v!.canCashout} onClick={() => act('cashout')}>
                {v!.canCashout ? `Cash out ${usd(stake * v!.multiplier)}` : 'Cross a lane to cash out'}
              </PlayButton>
            </>
          ) : (
            <PlayButton busy={busy} onClick={start}>
              {v ? 'Play again' : 'Start'}
            </PlayButton>
          )}
          <InfoRow label="Lanes" value={cfg?.chicken[level]?.lanes ?? '—'} />
          <InfoRow label="Max multiplier" value={ladder.length ? mult(ladder[ladder.length - 1]) : '—'} />
        </>
      }
      stage={
        <div className="chicken-stage">
          <div className="ck-hud">
            <div>
              <small>Multiplier</small>
              <b>{mult(v?.multiplier ?? 1)}</b>
            </div>
            <div>
              <small>Cash out value</small>
              <b className={v && v.lane > 0 && !v.dead ? 'win' : ''}>{usd(v && !v.dead ? stake * v.multiplier : 0)}</b>
            </div>
          </div>
          <div className="ck-road" ref={road}>
            <div className="ck-track" style={{ width: CURB_W * 2 + ladder.length * LANE_W }}>
              <div className="ck-curb start" style={{ width: CURB_W }} />
              {ladder.map((m, i) => {
                const passed = i < lane;
                const isNext = inPlay && i === lane;
                const car = v?.finished && v.cars?.[i];
                const killer = v?.dead && i === lane;
                return (
                  <div key={i} className={`ck-lane ${passed ? 'passed' : ''} ${isNext ? 'next' : ''} ${killer ? 'killer' : ''}`} style={{ width: LANE_W }}>
                    <div className={`ck-manhole ${passed ? 'done' : ''}`}>
                      <span>{mult(m)}</span>
                    </div>
                    {car && !killer && (
                      <div className="ck-car reveal">
                        <Car tone={i} />
                      </div>
                    )}
                    {killer && (
                      <div className="ck-car crash">
                        <Car tone={i} />
                      </div>
                    )}
                    {passed && <div className="ck-barrier" />}
                  </div>
                );
              })}
              <div className="ck-curb finish" style={{ width: CURB_W }}>
                <span>FINISH</span>
              </div>
              <div
                key={hop}
                className={`ck-chicken ${hop ? 'hop' : ''} ${v?.dead ? 'dead' : ''} ${v?.cashed ? 'happy' : ''}`}
                style={{ left: pos === 0 ? CURB_W / 2 - 34 : CURB_W + (pos - 1) * LANE_W + LANE_W / 2 - 34 }}
              >
                <svg viewBox="0 0 90 100" aria-hidden>
                  <ChickenSprite dead={!!v?.dead} />
                </svg>
              </div>
            </div>
          </div>
          {v?.finished && (
            <div className={`stage-banner ${v.dead ? 'loss' : 'win'}`}>
              {v.dead ? `Hit on lane ${lane + 1} — round lost` : `Safe! ${mult(v.multiplier)} · ${usd(round!.payout)}`}
            </div>
          )}
        </div>
      }
    />
  );
}

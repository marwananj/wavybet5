import { useEffect, useState } from 'react';
import { LuShuffle } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino, mult, type Round } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, Seg, useBet, useCasinoConfig } from '../shared';
import { sfx } from '../sound';

type Level = 'easy' | 'medium' | 'hard' | 'expert';
interface TowerView {
  level: Level;
  tiles: number;
  floors: number;
  floor: number;
  picks: number[];
  ladder: number[];
  multiplier: number;
  finished: boolean;
  dead: boolean;
  cashed: boolean;
  safe: number[][];
  canCashout: boolean;
}

const Gem = () => (
  <svg viewBox="0 0 40 36" className="tw-ico" aria-hidden>
    <path d="M8 2h24l8 11-20 22L0 13z" fill="#3ad0ff" />
    <path d="M8 2l5 11h14l5-11zM0 13h40L20 35z" fill="#1b8fd6" opacity=".55" />
    <path d="M13 13l7 22 7-22z" fill="#8ce6ff" opacity=".7" />
    <path d="M10 4l3 9" stroke="#fff" strokeWidth="1.6" opacity=".8" />
  </svg>
);
const Skull = () => (
  <svg viewBox="0 0 40 40" className="tw-ico" aria-hidden>
    <path d="M20 3C10 3 4 10 4 18c0 5 3 9 7 11v6h18v-6c4-2 7-6 7-11 0-8-6-15-16-15z" fill="#f1f3ff" />
    <circle cx="13.5" cy="19" r="4.6" fill="#1b1030" />
    <circle cx="26.5" cy="19" r="4.6" fill="#1b1030" />
    <path d="M20 23l-3 5h6z" fill="#1b1030" />
    <path d="M15 35v-4M20 35v-4M25 35v-4" stroke="#1b1030" strokeWidth="2" />
  </svg>
);

export function TowerGame() {
  const bet = useBet();
  const cfg = useCasinoConfig();
  const [amount, setAmount] = useState('1.00');
  const [level, setLevel] = useState<Level>('medium');
  const [round, setRound] = useState<Round<TowerView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (!bet.user) return;
    casino
      .active<TowerView>('tower')
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
  const L = cfg?.tower.levels[level];
  const floors = cfg?.tower.floors ?? 9;
  const tiles = v?.tiles ?? L?.tiles ?? 3;
  const ladder = v?.ladder ?? L?.ladder ?? [];
  const stake = round ? Number(round.stake) : Number(amount) || 0;
  const floor = v?.floor ?? 0;

  async function start() {
    const s = Number(amount) || 0;
    if (!bet.ensure(s)) return;
    setBusy(true);
    bet.debit(s);
    sfx.bet();
    try {
      const d = await casino.start<TowerView>('tower', { stake: s, level });
      setRound(d.round);
      bet.setBalance(d.balance);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: 'pick' | 'cashout', tile?: number) {
    if (!round || busy) return;
    setBusy(true);
    try {
      const d = await casino.act<TowerView>('tower', round.id, action, tile != null ? { tile } : {});
      const dv = d.round.view!;
      if (action === 'cashout') sfx.cashout();
      else if (dv.dead) {
        sfx.bomb();
        setShake((x) => x + 1);
      } else if (dv.finished) {
        sfx.gem();
        setTimeout(() => sfx.bigWin(), 250);
      } else {
        sfx.gem();
        setTimeout(() => sfx.step(dv.floor), 120);
      }
      setRound(d.round);
      bet.setBalance(d.balance);
      if (dv.finished) setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }
  const randomPick = () => act('pick', Math.floor(Math.random() * tiles));

  const nextMult = ladder[floor] ?? null;

  return (
    <GameShell
      game="tower"
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
          <ActionBar className={inPlay ? 'split' : ''}>
          {inPlay ? (
            <>
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={randomPick}>
                <LuShuffle size={16} /> Random<span className="hide-sm"> tile {nextMult ? `→ ${mult(nextMult)}` : ''}</span>
              </button>
              <PlayButton tone="cash" busy={busy} disabled={!v!.canCashout} onClick={() => act('cashout')}>
                {v!.canCashout ? `Cash out ${usd(stake * v!.multiplier)}` : 'Clear a floor to cash out'}
              </PlayButton>
            </>
          ) : (
            <PlayButton busy={busy} onClick={start}>
              {v ? 'Play again' : 'Start climbing'}
            </PlayButton>
          )}
          </ActionBar>
          <InfoRow label="Tiles per floor" value={L ? `${L.tiles} · ${L.tiles - L.safe} skull${L.tiles - L.safe > 1 ? 's' : ''}` : '—'} />
          <InfoRow label="Top floor pays" value={ladder.length ? mult(ladder[ladder.length - 1]) : '—'} />
        </>
      }
      stage={
        <div className="tower-stage">
          <div className="tw-hud">
            <div>
              <small>Floor</small>
              <b>
                {floor}/{floors}
              </b>
            </div>
            <div>
              <small>Multiplier</small>
              <b>{mult(v?.multiplier ?? 1)}</b>
            </div>
            <div>
              <small>Cash out value</small>
              <b className={v && floor > 0 && !v.dead ? 'win' : ''}>{usd(v && !v.dead ? stake * v.multiplier : 0)}</b>
            </div>
          </div>
          <div className="tw-scene">
            <div key={shake} className={`tw-tower ${shake ? 'shake' : ''} t${tiles}`}>
              <div className="tw-roof" />
              {Array.from({ length: floors }, (_, i) => floors - 1 - i).map((f) => {
                const active = inPlay && f === floor;
                const cleared = f < floor;
                const safe = v?.safe[f];
                const pick = v?.picks[f];
                const revealed = !!safe;
                return (
                  <div key={f} className={`tw-row ${active ? 'active' : ''} ${cleared ? 'cleared' : ''} ${!inPlay && !revealed ? 'idle' : ''}`}>
                    <span className="tw-mult">{mult(ladder[f] ?? 0)}</span>
                    <div className="tw-tiles">
                      {Array.from({ length: tiles }, (_, t) => {
                        const isSafe = safe?.includes(t);
                        const picked = pick === t;
                        const state = !revealed ? '' : isSafe ? 'safe' : 'bomb';
                        return (
                          <button
                            key={t}
                            type="button"
                            className={`tw-tile ${state} ${picked ? 'picked' : ''} ${revealed && !picked ? 'dim' : ''}`}
                            disabled={!active || busy}
                            onClick={() => act('pick', t)}
                            style={{ animationDelay: revealed && !picked ? `${(floors - f) * 35}ms` : '0ms' }}
                          >
                            <span className="tw-face">{revealed ? isSafe ? <Gem /> : <Skull /> : active ? <em>?</em> : null}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="tw-base" />
            </div>
          </div>
          {v?.finished && (
            <div className={`stage-banner ${v.dead ? 'loss' : 'win'}`}>
              {v.dead ? `Skull on floor ${floor + 1} — round lost` : `${floor === floors ? 'Top of the tower! ' : ''}Cashed ${mult(v.multiplier)} · ${usd(round!.payout)}`}
            </div>
          )}
        </div>
      }
    />
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LuTv, LuUsers } from 'react-icons/lu';
import { api, type ApiError } from '../../lib/api';
import { usd } from '../../lib/format';
import { useAuth, useToast } from '../../lib/state';
import { BackBar } from '../../components/Layout';
import { PlayingCard } from '../shared';
import { sfx, speak } from '../sound';
import { HoldemDealer, type DealerMood } from './HoldemDealer';

interface Market {
  id: string;
  label: string;
  odds: number;
  group: string;
}
interface Dice {
  red: number;
  blue: number;
}
interface War {
  player: { rank: number; suit: number };
  dealer: { rank: number; suit: number };
}
type Result = Dice | War;
interface TvBet {
  id: string;
  round: number;
  market: string;
  label: string;
  stake: string;
  odds: number;
  status: string;
  payout: string;
}
interface State {
  game: string;
  name: string;
  markets: Market[];
  period: number;
  betWindow: number;
  serverNow: number;
  round: number;
  roundStart: number;
  drawAt: number;
  nextAt: number;
  result: Result | null;
  history: { round: number; result: Result }[];
  mine: TvBet[];
  crowd: Record<string, { stake: number; bets: number }>;
}

const CHIPS = [0.5, 1, 5, 10, 25, 100];
const ANIM = 4200; // draw animation length
const RANK = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT = ['♠', '♥', '♦', '♣'];
const toCard = (c: { rank: number; suit: number }) => ({ rank: c.rank === 14 ? 1 : c.rank, suit: c.suit });

/* ───────────────────────────── 3D die ───────────────────────────── */

const FACE_ROT: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateY(-90deg)',
  4: 'rotateY(90deg)',
  5: 'rotateX(90deg)',
  6: 'rotateY(180deg)',
};
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Die({ value, rolling, color }: { value: number; rolling: boolean; color: 'red' | 'blue' }) {
  return (
    <div className={`tv-die ${color} ${rolling ? 'rolling' : ''}`}>
      <div className="tv-cube" style={{ transform: rolling ? undefined : FACE_ROT[value] }}>
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <span key={f} className={`tv-face f${f}`}>
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} className={PIPS[f].includes(i) ? 'on' : ''} />
            ))}
          </span>
        ))}
      </div>
      <div className="tv-die-shadow" />
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

const describe = (game: string, r: Result) => {
  if (game === 'tv-dice') {
    const d = r as Dice;
    return d.red > d.blue ? `Red wins, ${d.red} against ${d.blue}` : d.blue > d.red ? `Blue wins, ${d.blue} against ${d.red}` : `It's a draw, double ${d.red}`;
  }
  const w = r as War;
  const n = (c: { rank: number }) => (c.rank === 14 ? 'Ace' : c.rank === 13 ? 'King' : c.rank === 12 ? 'Queen' : c.rank === 11 ? 'Jack' : String(c.rank));
  return w.player.rank > w.dealer.rank ? `Player wins with ${n(w.player)}` : w.dealer.rank > w.player.rank ? `Dealer wins with ${n(w.dealer)}` : `War! Both draw ${n(w.player)}`;
};

function HistoryChip({ game, r }: { game: string; r: Result }) {
  if (game === 'tv-dice') {
    const d = r as Dice;
    const w = d.red > d.blue ? 'red' : d.blue > d.red ? 'blue' : 'draw';
    return (
      <span className={`tvh ${w}`}>
        <b>{d.red}</b>
        <i>:</i>
        <b>{d.blue}</b>
      </span>
    );
  }
  const x = r as War;
  const w = x.player.rank > x.dealer.rank ? 'player' : x.dealer.rank > x.player.rank ? 'dealer' : 'war';
  return (
    <span className={`tvh ${w}`}>
      {RANK[x.player.rank]}
      <em className={x.player.suit === 1 || x.player.suit === 2 ? 'r' : ''}>{SUIT[x.player.suit]}</em>
      <i>v</i>
      {RANK[x.dealer.rank]}
      <em className={x.dealer.suit === 1 || x.dealer.suit === 2 ? 'r' : ''}>{SUIT[x.dealer.suit]}</em>
    </span>
  );
}

/* ───────────────────────────── the studio ───────────────────────────── */

export function TvGame({ game }: { game: 'tv-dice' | 'tv-war' }) {
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [st, setSt] = useState<State | null>(null);
  const [offset, setOffset] = useState(0); // server - local clock
  const [now, setNow] = useState(Date.now());
  const [chip, setChip] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [talk, setTalk] = useState<{ line: string; mood: DealerMood; key: number }>({ line: 'Welcome to Wavy TV!', mood: 'idle', key: 0 });
  const announced = useRef<number>(-1);
  const closedSaid = useRef<number>(-1);

  const load = () =>
    api<State>(`/tv/${game}/state`)
      .then((d) => {
        setOffset(d.serverNow - Date.now());
        setSt(d);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 3000);
    return () => clearInterval(t);
  }, [game, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const t = now + offset;
  const phase = !st ? 'loading' : t < st.drawAt ? 'betting' : t < st.drawAt + ANIM ? 'drawing' : t < st.nextAt ? 'result' : 'next';

  // refresh exactly at the draw and at the next round
  useEffect(() => {
    if (!st) return;
    const timers = [st.drawAt + 120, st.drawAt + ANIM + 300, st.nextAt + 150].map((at) => window.setTimeout(load, Math.max(0, at - (Date.now() + offset))));
    return () => timers.forEach(clearTimeout);
  }, [st?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (line: string, mood: DealerMood = 'talk', voice?: string) => {
    setTalk((x) => ({ line, mood, key: x.key + 1 }));
    if (voice && document.visibilityState === 'visible') speak(voice, { rate: 1.03 });
  };

  // host lines
  useEffect(() => {
    if (!st) return;
    if (phase === 'betting' && closedSaid.current !== st.round && st.drawAt - t > st.betWindow - 1500) say('Place your bets — a new draw is open!', 'talk');
    if (phase === 'drawing' && closedSaid.current !== st.round) {
      closedSaid.current = st.round;
      say('No more bets… here we go!', 'talk', 'No more bets.');
      sfx.whoosh(0.5);
    }
    if ((phase === 'result' || (phase === 'drawing' && t > st.drawAt + ANIM - 300)) && st.result && announced.current !== st.round) {
      announced.current = st.round;
      const line = describe(game, st.result);
      const myRound = st.mine.filter((b) => b.round === st.round);
      const won = myRound.filter((b) => myWins(game, b.market, st.result!));
      say(`${line}!`, 'happy', line);
      if (game === 'tv-dice') sfx.clack();
      else sfx.flip();
      if (won.length) setTimeout(() => sfx.win(), 400);
    }
  }, [phase, st?.round, !!st?.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // when my bets settle, update balance
  const settledKey = st?.mine.filter((b) => b.status !== 'OPEN').map((b) => b.id).join(',');
  const firstSettle = useRef(true);
  useEffect(() => {
    if (firstSettle.current) {
      firstSettle.current = false;
      return;
    }
    if (!user || !st) return;
    const wonNow = st.mine.filter((b) => b.round === st.round && b.status === 'WON');
    if (wonNow.length) toast('ok', `You won ${usd(wonNow.reduce((a, b) => a + Number(b.payout), 0))} on Wavy TV!`);
    api<{ user: { balance: string } }>('/auth/me').then((d) => setBalance(d.user.balance)).catch(() => {});
  }, [settledKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = async (m: Market) => {
    if (!user) return openAuth('login');
    if (phase !== 'betting') return toast('info', 'Betting opens with the next draw');
    setBusy(m.id);
    sfx.chip();
    try {
      const d = await api<{ bet: TvBet; balance: string }>(`/tv/${game}/bet`, { body: { market: m.id, stake: chip } });
      setBalance(d.balance);
      setSt((s) => (s ? { ...s, mine: [d.bet, ...s.mine], crowd: { ...s.crowd, [m.id]: { stake: (s.crowd[m.id]?.stake ?? 0) + chip, bets: (s.crowd[m.id]?.bets ?? 0) + 1 } } } : s));
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'EMAIL_UNVERIFIED') openAuth('verify');
      toast('err', err.message);
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const g = new Map<string, Market[]>();
    st?.markets.forEach((m) => g.set(m.group, [...(g.get(m.group) ?? []), m]));
    return [...g.entries()];
  }, [st?.markets]);
  const myRound = st?.mine.filter((b) => b.round === st.round) ?? [];
  const stakeOn = (id: string) => myRound.filter((b) => b.market === id).reduce((a, b) => a + Number(b.stake), 0);
  const showResult = !!st?.result && (phase === 'result' || (phase === 'drawing' && t > st.drawAt + ANIM - 300));
  const rolling = phase === 'drawing' && !showResult;
  const winning = (m: Market) => {
    if (!showResult || !st?.result) return false;
    return myWins(game, m.id, st.result);
  };
  const left = st ? Math.max(0, st.drawAt - t) : 0;
  const pct = st ? Math.max(0, Math.min(1, left / st.betWindow)) : 0;
  const dice = st?.result as Dice | null;
  const war = st?.result as War | null;

  return (
    <div className="page tv-page">
      <BackBar title={`Wavy TV · ${game === 'tv-dice' ? 'Dice Duel' : 'Card War'}`} />
      <section className={`tv-screen ${game} ph-${phase}`}>
        <div className="tv-bug">
          <LuTv size={14} /> WAVY<b>TV</b> <i className="live-dot" /> LIVE
        </div>
        <div className="tv-round">Draw #{st ? String(st.round % 100000).padStart(5, '0') : '—'}</div>
        <div className="tv-host">
          <HoldemDealer mood={talk.mood} line={talk.line} lineKey={talk.key} dealing={phase === 'drawing'} />
        </div>
        <div className="tv-table">
          {game === 'tv-dice' ? (
            <div className="tv-duel">
              <div className={`tv-side red ${showResult && dice && dice.red > dice.blue ? 'win' : ''}`}>
                <span>RED</span>
                <Die value={dice?.red ?? 1} rolling={rolling || !dice} color="red" />
                {showResult && dice && <b>{dice.red}</b>}
              </div>
              <em className="tv-vs">VS</em>
              <div className={`tv-side blue ${showResult && dice && dice.blue > dice.red ? 'win' : ''}`}>
                <span>BLUE</span>
                <Die value={dice?.blue ?? 1} rolling={rolling || !dice} color="blue" />
                {showResult && dice && <b>{dice.blue}</b>}
              </div>
            </div>
          ) : (
            <div className="tv-duel">
              <div className={`tv-side player ${showResult && war && war.player.rank > war.dealer.rank ? 'win' : ''}`}>
                <span>PLAYER</span>
                {phase === 'betting' || !war ? <PlayingCard faceDown className="ghost-card" /> : <PlayingCard card={showResult ? toCard(war.player) : null} faceDown={!showResult} className="deal tv-card" />}
              </div>
              <em className="tv-vs">VS</em>
              <div className={`tv-side dealer ${showResult && war && war.dealer.rank > war.player.rank ? 'win' : ''}`}>
                <span>DEALER</span>
                {phase === 'betting' || !war ? <PlayingCard faceDown className="ghost-card" /> : <PlayingCard card={showResult ? toCard(war.dealer) : null} faceDown={!showResult} className="deal tv-card" style={{ animationDelay: '250ms' }} />}
              </div>
            </div>
          )}
          {showResult && st?.result && <div className="tv-result">{describe(game, st.result)}</div>}
        </div>
        <div className="tv-timer">
          {phase === 'betting' ? (
            <>
              <span>Place your bets</span>
              <div className="tv-bar">
                <i style={{ width: `${pct * 100}%` } as CSSProperties} className={left < 6000 ? 'hurry' : ''} />
              </div>
              <b>{Math.ceil(left / 1000)}s</b>
            </>
          ) : phase === 'drawing' ? (
            <span className="tv-live">● Drawing…</span>
          ) : (
            <span>Next draw in {st ? Math.max(0, Math.ceil((st.nextAt - t) / 1000)) : 0}s</span>
          )}
        </div>
        <div className="tv-history">
          {st?.history.map((h) => (
            <HistoryChip key={h.round} game={game} r={h.result} />
          ))}
        </div>
      </section>

      <section className="tv-bets">
        <div className="tv-chips">
          {CHIPS.map((c) => (
            <button key={c} type="button" className={`tv-chip c${String(c).replace('.', '_')} ${chip === c ? 'on' : ''}`} onClick={() => (sfx.click(), setChip(c))}>
              {c < 1 ? c.toFixed(1) : c}
            </button>
          ))}
        </div>
        {groups.map(([g, ms]) => (
          <div key={g} className="tv-group">
            <h4>{g}</h4>
            <div className="tv-markets">
              {ms.map((m) => {
                const mineAmt = stakeOn(m.id);
                const crowd = st?.crowd[m.id];
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`tv-mkt m-${m.id} ${winning(m) ? 'won' : ''} ${mineAmt ? 'has' : ''}`}
                    disabled={phase !== 'betting' || busy === m.id}
                    onClick={() => place(m)}
                  >
                    <span>{m.label}</span>
                    <b>{m.odds.toFixed(2)}</b>
                    {mineAmt > 0 && <em className="tv-stake">{usd(mineAmt)}</em>}
                    {crowd && crowd.bets > 0 && (
                      <small className="tv-crowd">
                        <LuUsers size={10} /> {crowd.bets}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {user && st && st.mine.length > 0 && (
          <div className="tv-mine">
            <h4>My bets</h4>
            {st.mine.slice(0, 8).map((b) => (
              <div key={b.id} className={`st-${b.status.toLowerCase()}`}>
                <span>#{String(b.round % 100000).padStart(5, '0')}</span>
                <span className="ellipsis">{b.label}</span>
                <span>
                  {usd(b.stake)} @ {b.odds.toFixed(2)}
                </span>
                <b>{b.status === 'OPEN' ? 'Open' : b.status === 'WON' ? `+${usd(b.payout)}` : 'Lost'}</b>
              </div>
            ))}
          </div>
        )}
        <small className="muted">
          A new draw every {st ? st.period / 1000 : 40} seconds — everyone sees the same result. Results come from a daily secret seed published as a hash and revealed the next
          day (provably fair). ~96% RTP.
        </small>
      </section>
    </div>
  );
}

function myWins(game: string, market: string, r: Result) {
  if (game === 'tv-dice') {
    const { red, blue } = r as Dice;
    const t = red + blue;
    return (
      ({ red: red > blue, blue: blue > red, draw: red === blue, under7: t < 7, over7: t > 7, seven: t === 7, double: red === blue, red6: red === 6, blue6: blue === 6 } as Record<string, boolean>)[market] ?? false
    );
  }
  const { player, dealer } = r as War;
  return (
    ({
      player: player.rank > dealer.rank,
      dealer: dealer.rank > player.rank,
      war: player.rank === dealer.rank,
      p_red: player.suit === 1 || player.suit === 2,
      p_black: player.suit === 0 || player.suit === 3,
      p_high: player.rank >= 8,
      p_face: player.rank >= 11,
    } as Record<string, boolean>)[market] ?? false
  );
}

export const TvDice = () => <TvGame game="tv-dice" />;
export const TvWar = () => <TvGame game="tv-war" />;

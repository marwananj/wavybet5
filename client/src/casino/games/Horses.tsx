import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LuX, LuTrash2, LuFastForward, LuTrophy, LuTimer } from 'react-icons/lu';
import { ApiError } from '../../lib/api';
import { usd } from '../../lib/format';
import { casino } from '../api';
import { ActionBar, BetAmount, GameShell, PlayButton, useBet, useMedia } from '../shared';
import { isMuted, raceAmbience, resultSound, sfx } from '../sound';
import { CLOTH, HorseSprite, SilksIcon, type Silks } from '../horses/HorseSprite';
import { fmtTime, lengthsText, makePlan, posAt, T_WINNER, type Plan } from '../horses/race';

/* ─────────────────────────────── types ─────────────────────────────── */

interface Runner {
  no: number;
  name: string;
  jockey: string;
  silks: Silks;
  form: string;
  age: number;
  weight: number;
  style: number;
  win: number;
  place: number;
}
interface Card {
  id: string;
  race: number;
  distance: number;
  runners: Runner[];
  forecast: number[][];
  quinella: number[][];
}
type BetType = 'win' | 'place' | 'forecast' | 'quinella';
interface Sel {
  key: string;
  type: BetType;
  horses: number[];
  odds: number;
  stake: string;
}
interface RaceResult {
  race: number;
  cardId: string;
  order: number[];
  margins: number[];
  time: number;
  returned: number;
  bets: { type: BetType; horses: number[]; amount: number; odds: number; won: boolean; returned: number }[];
}

const TYPE_LABEL: Record<BetType, string> = { win: 'Win', place: 'Place (top 3)', forecast: 'Forecast', quinella: 'Quinella' };
const selKey = (type: BetType, horses: number[]) => `${type}:${type === 'quinella' ? [...horses].sort((a, b) => a - b).join('-') : horses.join('-')}`;
const oddsOf = (c: Card, type: BetType, h: number[]) =>
  type === 'win' ? c.runners[h[0]].win : type === 'place' ? c.runners[h[0]].place : type === 'forecast' ? c.forecast[h[0]][h[1]] : c.quinella[h[0]][h[1]];
const fmtOdds = (o: number) => (o >= 100 ? o.toFixed(0) : o.toFixed(2));
const selLabel = (c: Card, s: Pick<Sel, 'type' | 'horses'>) =>
  s.horses.map((h) => `#${h + 1} ${c.runners[h].name}`).join(s.type === 'forecast' ? ' → ' : ' & ');

function Cloth({ no, small }: { no: number; small?: boolean }) {
  const c = CLOTH[(no - 1) % 8];
  return (
    <span className={`cloth ${small ? 'sm' : ''}`} style={{ background: c.bg, color: c.fg }}>
      {no}
    </span>
  );
}

/* ─────────────────────────────── commentary ─────────────────────────────── */

function useCommentator() {
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    const pick = () => {
      const v = synth.getVoices();
      voice.current =
        v.find((x) => /en-GB/i.test(x.lang) && /male|daniel|george|arthur|ryan/i.test(x.name)) ??
        v.find((x) => /en-GB/i.test(x.lang)) ??
        v.find((x) => /^en/i.test(x.lang)) ??
        null;
    };
    pick();
    synth.addEventListener?.('voiceschanged', pick);
    return () => {
      synth.removeEventListener?.('voiceschanged', pick);
      synth.cancel();
    };
  }, []);
  return useCallback((text: string, urgent = false) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || isMuted()) return;
    try {
      if (urgent || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice.current) u.voice = voice.current;
      u.lang = voice.current?.lang ?? 'en-GB';
      u.rate = urgent ? 1.2 : 1.1;
      u.pitch = 1;
      u.volume = 1;
      synth.speak(u);
    } catch {
      /* speech not available */
    }
  }, []);
}

/* ─────────────────────────────── race view ─────────────────────────────── */

const MARKERS = [1000, 800, 600, 400, 200];

function RaceView({
  card,
  plan,
  running,
  finished,
  skip,
  onFinish,
  onLine,
}: {
  card: Card;
  plan: Plan | null;
  running: boolean;
  finished: boolean;
  skip: number;
  onFinish: () => void;
  onLine: (text: string) => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const horses = useRef<(HTMLDivElement | null)[]>([]);
  const turf = useRef<HTMLDivElement>(null);
  const railFar = useRef<HTMLDivElement>(null);
  const railNear = useRef<HTMLDivElement>(null);
  const stand = useRef<HTMLDivElement>(null);
  const hills = useRef<HTMLDivElement>(null);
  const markers = useRef<(HTMLDivElement | null)[]>([]);
  const post = useRef<HTMLDivElement>(null);
  const stalls = useRef<HTMLDivElement>(null);
  const mapPath = useRef<SVGPathElement>(null);
  const mapDots = useRef<(SVGCircleElement | null)[]>([]);
  const t0 = useRef(0);
  const cam = useRef({ x: 0, ppm: 30 });
  const [hud, setHud] = useState<{ order: number[]; toGo: number; t: number }>({ order: card.runners.map((_, i) => i), toGo: card.distance, t: 0 });
  const [flash, setFlash] = useState(0);
  const [photo, setPhoto] = useState(false);
  const say = useCommentator();
  const skipReq = useRef(skip);
  useEffect(() => {
    skipReq.current = skip;
  }, [skip]);

  const n = card.runners.length;
  const name = (i: number) => card.runners[i].name;

  // main loop
  useEffect(() => {
    let raf = 0;
    const amb = running ? raceAmbience() : null;
    if (running) {
      t0.current = performance.now() + 1500; // stalls → bell → off
      sfx.bell();
      say(`They're in the stalls for race ${card.race}... and they're off!`, true);
      onLine("They're off!");
      setTimeout(() => sfx.gates(), 1450);
    }
    const said = new Set<string>();
    let lastLeader = -1;
    let lastLeadChange = 0;
    let lastHud = 0;
    let done = false;
    let crossed = false;
    let handledSkip = skipReq.current;
    const fav = card.runners.reduce((b, r, i) => (r.win < card.runners[b].win ? i : b), 0);
    const loop = (now: number) => {
      const el = view.current;
      if (!el) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      let t = running && plan ? (now - t0.current) / 1000 : 0;
      if (skipReq.current !== handledSkip && plan && running) {
        handledSkip = skipReq.current;
        // skip straight to the finish
        t0.current = now - (Math.max(...plan.finish) + 0.4) * 1000;
        t = Math.max(...plan.finish) + 0.4;
      }
      // after the race the view freezes on the photo-finish frame
      const xs = card.runners.map((_, i) => (plan && (running || finished) ? posAt(plan, i, finished && !running ? T_WINNER + 0.02 : Math.max(0, t)) : 0));
      const lead = xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);
      const leadX = Math.max(...xs);
      const lastX = Math.min(...xs);
      // camera: zoom to fit the field, leader at ~68% of the screen
      const spread = Math.max(8, leadX - lastX + 7);
      const target = Math.min(W / 16, Math.max(W / 55, (W * 0.6) / spread));
      const c = cam.current;
      c.ppm += (target - c.ppm) * 0.06;
      const focus = Math.min(leadX, card.distance + 25);
      c.x += (focus - c.x) * (running ? 0.18 : 1);
      const toScreen = (x: number) => W * 0.68 + (x - c.x) * c.ppm;
      const trackTop = H * 0.43;
      const laneH = (H * 0.5) / n;
      // horses
      for (let i = 0; i < n; i++) {
        const h = horses.current[i];
        if (!h) continue;
        const depth = 0.74 + (0.26 * i) / (n - 1);
        // sprites keep a TV-camera size tied to the lane spacing; the zoom changes the gaps
        const w = laneH * 2.5 * (170 / 130) * depth;
        const hh = (w * 130) / 170;
        const x = toScreen(xs[i] - (plan ? 0 : 1.6)) - w * 0.92;
        const y = trackTop + (i + 0.85) * laneH - hh * 0.95;
        h.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        h.style.width = `${w.toFixed(1)}px`;
        h.style.zIndex = String(10 + i);
      }
      // scenery (parallax)
      const origin = toScreen(0);
      if (turf.current) {
        turf.current.style.backgroundSize = `${(12 * c.ppm).toFixed(1)}px 100%`;
        turf.current.style.backgroundPositionX = `${origin.toFixed(1)}px`;
      }
      for (const r of [railFar.current, railNear.current]) {
        if (!r) continue;
        r.style.backgroundSize = `${(3 * c.ppm).toFixed(1)}px 100%, 100% 100%`;
        r.style.backgroundPositionX = `${origin.toFixed(1)}px, 0`;
      }
      if (stand.current) stand.current.style.backgroundPositionX = `${(-c.x * 3).toFixed(1)}px`;
      if (hills.current) hills.current.style.backgroundPositionX = `${(-c.x * 0.6).toFixed(1)}px`;
      MARKERS.forEach((m, k) => {
        const e = markers.current[k];
        if (e) e.style.transform = `translateX(${(toScreen(card.distance - m) - 14).toFixed(1)}px)`;
      });
      if (post.current) post.current.style.transform = `translateX(${(toScreen(card.distance) - 6).toFixed(1)}px)`;
      if (stalls.current) stalls.current.style.transform = `translateX(${(toScreen(0) - 10).toFixed(1)}px)`;
      // mini map
      const path = mapPath.current;
      if (path) {
        const L = path.getTotalLength();
        for (let i = 0; i < n; i++) {
          const d = mapDots.current[i];
          if (!d) continue;
          const f = Math.min(1, xs[i] / card.distance);
          const p = path.getPointAtLength(L * (0.25 + 0.75 * f) - 0.01);
          d.setAttribute('cx', p.x.toFixed(1));
          d.setAttribute('cy', p.y.toFixed(1));
        }
      }
      // sound + commentary
      if (running && plan) {
        const toGo = Math.max(0, card.distance - leadX);
        amb?.set(t > 0 && leadX < card.distance + 10 ? 1 : Math.max(0, 1 - (t - T_WINNER) / 3), t < 0 ? 0.15 : 0.25 + Math.min(1, Math.max(0, (card.distance - toGo) / card.distance)) ** 3 * 0.75);
        const ord = [...xs.keys()].sort((a, b) => xs[b] - xs[a]);
        const line = (k: string, text: string, speak = true, urgent = false) => {
          if (said.has(k)) return;
          said.add(k);
          onLine(text);
          if (speak) say(text, urgent);
        };
        if (t > 3 && t < 5) line('early', `${name(ord[0])} breaks smartly and leads, ${name(ord[1])} tracking, ${name(fav)} the favourite settles in ${ord.indexOf(fav) + 1 === 1 ? 'front' : `${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'last'][ord.indexOf(fav) + 1]}`}.`);
        if (toGo < 700 && toGo > 500) line('half', `Past halfway, ${name(ord[0])} from ${name(ord[1])} and ${name(ord[2])}.`);
        if (toGo < 350 && toGo > 200) line('straight', `Into the straight! ${name(ord[0])} kicks for home, ${name(ord[1])} and ${name(ord[2])} coming to challenge!`, true, true);
        if (toGo < 120 && toGo > 0) line('final', `Final furlong! ${name(ord[0])}... ${name(ord[1])} is closing!`, true, true);
        if (lead !== lastLeader && t > 5 && toGo > 60 && now - lastLeadChange > 3500) {
          if (lastLeader !== -1) {
            onLine(`${name(lead)} takes it up!`);
            if (toGo > 380 && toGo < 1000) say(`${name(lead)} takes it up!`);
          }
          lastLeadChange = now;
        }
        lastLeader = lead;
        if (!crossed && t >= T_WINNER) {
          crossed = true;
          const [w, s2, s3] = plan.order;
          const close = plan.margins[1] < 0.3;
          setFlash((f) => f + 1);
          setPhoto(close);
          sfx.gates();
          const text = close
            ? `It's a photo! ... ${name(w)} gets it by ${lengthsText(plan.margins[1])}! ${name(s2)} second, ${name(s3)} third.`
            : `${name(w)} wins race ${card.race}! ${name(s2)} second, ${name(s3)} third.`;
          line('finish', text, true, true);
        }
        if (now - lastHud > 180) {
          lastHud = now;
          setHud({ order: ord, toGo, t: Math.max(0, t) });
        }
        if (!done && t > Math.max(...plan.finish) + 1.1) {
          done = true;
          amb?.set(0, 0.4);
          setTimeout(() => amb?.stop(), 1200);
          onFinish();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      amb?.stop();
    };
  }, [running, plan, card, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const galloping = running;
  const toGoText = hud.toGo > 0 ? `${Math.ceil(hud.toGo / 10) * 10}m to go` : 'Finished';

  return (
    <>
    <div className={`hr-view ${running ? 'live' : ''}`} ref={view}>
      <div className="hr-sky" />
      <div className="hr-hills" ref={hills} />
      <div className="hr-stand" ref={stand}>
        <span className="hr-roof" />
      </div>
      <div className="hr-rail far" ref={railFar} />
      <div className="hr-turf" ref={turf} />
      <div className="hr-world">
        {MARKERS.map((m, k) => (
          <div key={m} className="hr-marker" ref={(e) => void (markers.current[k] = e)}>
            <b>{m}</b>
          </div>
        ))}
        <div className="hr-post" ref={post}>
          <span>FINISH</span>
        </div>
        <div className={`hr-stalls ${running ? 'open' : ''}`} ref={stalls}>
          {card.runners.map((r) => (
            <i key={r.no}>
              <em>{r.no}</em>
            </i>
          ))}
        </div>
      </div>
      {card.runners.map((r, i) => (
        <div key={`${card.id}-${r.no}`} className="hr-horse" ref={(e) => void (horses.current[i] = e)} style={{ '--stride': `${0.4 + ((i * 7) % 5) * 0.012}s`, '--phase': `${-((i * 0.137) % 0.4)}s` } as CSSProperties}>
          <HorseSprite no={r.no} silks={r.silks} uid={`${card.id}${i}`} running={galloping} />
        </div>
      ))}
      <div className="hr-rail near" ref={railNear} />
      {flash > 0 && <div key={flash} className="hr-flash" />}
      {photo && <div className="hr-photo">PHOTO FINISH</div>}

      {/* HUD */}
      <div className="hr-hud-top">
        <div className="hr-title">
          <span className={`rl-live ${running ? '' : 'idle'}`}>
            <i /> {running ? 'LIVE' : finished ? 'RESULT' : 'NEXT'}
          </span>
          <b>Race {card.race}</b>
          <small>{card.distance}m · Wavy Downs</small>
        </div>
        <div className="hr-togo">
          <LuTimer size={13} /> {running ? `${fmtTime(hud.t)} · ${toGoText}` : finished ? 'Result' : 'Awaiting bets'}
        </div>
      </div>
      <svg className="hr-map" viewBox="0 0 120 64" aria-hidden>
        <path ref={mapPath} d="M30 6 H90 A26 26 0 0 1 90 58 H30 A26 26 0 0 1 30 6 Z" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="5" strokeLinecap="round" />
        <path d="M30 6 H90 A26 26 0 0 1 90 58 H30 A26 26 0 0 1 30 6 Z" fill="none" stroke="#1d7a3c" strokeWidth="3" />
        <line x1="30" y1="0" x2="30" y2="12" stroke="#fff" strokeWidth="1.6" />
        {card.runners.map((r, i) => (
          <circle key={r.no} r="3.2" cx="30" cy="6" fill={CLOTH[i].bg} stroke="#000" strokeWidth=".6" ref={(e) => void (mapDots.current[i] = e)} />
        ))}
      </svg>
    </div>
    <div className="hr-positions">
      <span className="hr-pos-label">{running || finished ? 'Running order' : 'Runners'}</span>
      {hud.order.map((i, pos) => (
        <span key={i} className="hr-pos" style={{ order: pos + 1 }}>
          <em>{pos + 1}</em>
          <Cloth no={i + 1} small />
        </span>
      ))}
    </div>
    </>
  );
}

/* ─────────────────────────────── betting area ─────────────────────────────── */

function RaceCardTable({ card, sels, toggle, locked, result }: { card: Card; sels: Map<string, Sel>; toggle: (t: BetType, h: number[]) => void; locked: boolean; result: RaceResult | null }) {
  const [tab, setTab] = useState<'wp' | 'forecast' | 'quinella'>('wp');
  const pos = (i: number) => (result ? result.order.indexOf(i) + 1 : 0);
  const btn = (type: BetType, h: number[], odds: number, extra = '') => {
    const k = selKey(type, h);
    const on = sels.has(k);
    const won = result && result.bets.some((b) => selKey(b.type, b.horses) === k && b.won);
    return (
      <button type="button" key={k} className={`odds-btn ${on ? 'on' : ''} ${won ? 'won' : ''} ${extra}`} disabled={locked} onClick={() => toggle(type, h)}>
        {fmtOdds(odds)}
      </button>
    );
  };
  return (
    <div className={`hr-card ${locked ? 'locked' : ''}`}>
      <div className="hr-card-head">
        <div className="hr-tabs">
          {(
            [
              ['wp', 'Win & Place'],
              ['forecast', 'Forecast'],
              ['quinella', 'Quinella'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => (sfx.click(), setTab(v))}>
              {l}
            </button>
          ))}
        </div>
        <small className="muted">
          {tab === 'wp' ? 'Place pays if your horse finishes 1st, 2nd or 3rd.' : tab === 'forecast' ? 'Pick 1st (row) and 2nd (column) in exact order.' : 'Pick the first two in either order.'}
        </small>
      </div>
      {tab === 'wp' ? (
        <div className="hr-runners">
          <div className="hr-row head">
            <span>#</span>
            <span />
            <span>Runner</span>
            <span className="hide-sm">Form</span>
            <span>Win</span>
            <span>Place</span>
          </div>
          {card.runners.map((r, i) => (
            <div key={r.no} className={`hr-row ${pos(i) && pos(i) <= 3 ? `p${pos(i)}` : ''}`}>
              <span>
                <Cloth no={r.no} />
              </span>
              <span>
                <SilksIcon s={r.silks} uid={`${card.id}-${i}`} />
              </span>
              <span className="hr-name">
                <b>
                  {r.name}
                  {pos(i) > 0 && <em className="hr-fin">{pos(i) === 1 ? '1st' : pos(i) === 2 ? '2nd' : pos(i) === 3 ? '3rd' : `${pos(i)}th`}</em>}
                </b>
                <small>
                  {r.jockey} · {r.age}yo · {r.weight}kg<span className="show-sm"> · {r.form}</span>
                </small>
              </span>
              <span className="hr-form hide-sm">
                {r.form.split('').map((f, k) => (
                  <i key={k} className={f === '1' ? 'f1' : f === '2' || f === '3' ? 'f2' : ''}>
                    {f}
                  </i>
                ))}
              </span>
              {btn('win', [i], r.win)}
              {btn('place', [i], r.place)}
            </div>
          ))}
        </div>
      ) : (
        <div className="hr-matrix-wrap">
          <div className="hr-matrix" style={{ '--n': card.runners.length } as CSSProperties}>
            <span className="corner">{tab === 'forecast' ? '1st ↓ 2nd →' : ''}</span>
            {card.runners.map((r) => (
              <span key={`h${r.no}`} className="mh">
                <Cloth no={r.no} small />
              </span>
            ))}
            {card.runners.map((r, a) => (
              <div key={`r${r.no}`} className="mrow">
                <span className="mh">
                  <Cloth no={r.no} small />
                </span>
                {card.runners.map((_, b) =>
                  a === b || (tab === 'quinella' && b < a) ? (
                    <span key={b} className="mx" />
                  ) : (
                    btn(tab, [a, b], tab === 'forecast' ? card.forecast[a][b] : card.quinella[a][b], 'mini')
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── game ─────────────────────────────── */

type Phase = 'card' | 'race' | 'result';

export function HorsesGame() {
  const bet = useBet();
  const tall = useMedia('(max-width: 559px)');
  const [card, setCard] = useState<Card | null>(null);
  const [amount, setAmount] = useState('1.00');
  const [sels, setSels] = useState<Map<string, Sel>>(new Map());
  const [phase, setPhase] = useState<Phase>('card');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [payout, setPayout] = useState<{ stake: number; returned: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [skip, setSkip] = useState(0);
  const [ticker, setTicker] = useState<string[]>([]);
  const [past, setPast] = useState<{ race: number; no: number; name: string }[]>([]);
  const [showResult, setShowResult] = useState(false);
  const pending = useRef<{ balance: string; returned: number; stake: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const loadCard = useCallback(async (keep = true) => {
    const d = await casino.horseCard<Card>();
    setCard(d.card);
    // keep the same selections on the new card with fresh prices
    setSels((old) => {
      if (!keep) return new Map();
      const m = new Map<string, Sel>();
      old.forEach((s) => m.set(s.key, { ...s, odds: oddsOf(d.card, s.type, s.horses) }));
      return m;
    });
    return d.card;
  }, []);

  useEffect(() => {
    loadCard(false).catch(() => bet.toast('err', 'Could not load the race card'));
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = [...sels.values()];
  const total = Math.round(list.reduce((a, s) => a + (Number(s.stake) || 0), 0) * 100) / 100;
  const potential = Math.round(list.reduce((a, s) => a + (Number(s.stake) || 0) * s.odds, 0) * 100) / 100;
  const racing = phase === 'race';

  const toggle = (type: BetType, horses: number[]) => {
    if (!card || racing) return;
    const key = selKey(type, horses);
    sfx.chip();
    setSels((m) => {
      const n = new Map(m);
      if (n.has(key)) n.delete(key);
      else n.set(key, { key, type, horses, odds: oddsOf(card, type, horses), stake: amount });
      return n;
    });
  };
  const setStake = (key: string, v: string) =>
    setSels((m) => {
      const n = new Map(m);
      const s = n.get(key);
      if (s) n.set(key, { ...s, stake: v.replace(/[^0-9.]/g, '') });
      return n;
    });
  const remove = (key: string) =>
    setSels((m) => {
      const n = new Map(m);
      n.delete(key);
      return n;
    });

  function nextRace(keep: boolean) {
    // the next card belongs to the next nonce; keep the same bets at the new prices
    loadCard(keep).catch(() => bet.toast('err', 'Could not load the race card'));
    setPhase('card');
    setResult(null);
    setPlan(null);
    setPayout(null);
    setShowResult(false);
    setTicker([]);
    if (!keep) setSels(new Map());
  }

  async function race() {
    if (!card || !list.length) return bet.toast('info', 'Pick a runner on the race card first');
    if (list.some((s) => !(Number(s.stake) > 0))) return bet.toast('info', 'Every selection needs a stake');
    if (!bet.ensure(total)) return;
    setBusy(true);
    bet.debit(total);
    sfx.bet();
    try {
      const res = await casino.play<RaceResult>('horses', {
        cardId: card.id,
        bets: list.map((s) => ({ type: s.type, horses: s.horses, amount: Number(s.stake) })),
      });
      const r = res.result;
      pending.current = { balance: res.balance, returned: r.returned, stake: total };
      setResult(r);
      setPlan(makePlan(card.distance, r.order, r.margins, card.runners.map((x) => x.style), card.id));
      setTicker(['Runners are loaded into the stalls…']);
      setPhase('race');
      if (tall) viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      bet.fail(e);
      if ((e as ApiError).message?.includes('race card changed')) loadCard(true).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const onFinish = useCallback(() => {
    const p = pending.current;
    setPhase('result');
    setShowResult(true);
    if (p) {
      bet.setBalance(p.balance);
      setPayout({ stake: p.stake, returned: p.returned });
      setTimeout(() => resultSound(p.stake ? p.returned / p.stake : 0), 300);
    }
    setRefresh((x) => x + 1);
    setResult((r) => {
      if (r && card) setPast((h) => [{ race: r.race, no: r.order[0] + 1, name: card.runners[r.order[0]].name }, ...h].slice(0, 8));
      return r;
    });
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps

  // the card shown during/after a race is the one that was raced
  const [racedCard, setRacedCard] = useState<Card | null>(null);
  useEffect(() => {
    if (phase === 'race' && card) setRacedCard(card);
    if (phase === 'card') setRacedCard(null);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (phase !== 'card' && racedCard) || card;
  const onLine = useCallback((t: string) => setTicker((l) => [t, ...l].slice(0, 4)), []);

  const net = payout ? payout.returned - payout.stake : 0;
  const favIdx = useMemo(() => (shown ? shown.runners.reduce((b, r, i) => (r.win < shown.runners[b].win ? i : b), 0) : 0), [shown]);

  return (
    <GameShell
      game="horses"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={racing} label="Default stake" />
          <div className="hr-slip">
            <div className="hr-slip-head">
              <b>Bet slip</b>
              <span>{list.length} selection{list.length === 1 ? '' : 's'}</span>
              {list.length > 0 && !racing && (
                <button type="button" className="mini-btn" onClick={() => (sfx.click(), setSels(new Map()))} aria-label="Clear slip">
                  <LuTrash2 size={13} />
                </button>
              )}
            </div>
            {!list.length && <p className="muted hr-slip-empty">Tap a price on the race card to add a bet.</p>}
            {shown &&
              list.map((s) => {
                const settled = phase === 'result' && result ? result.bets.find((b) => selKey(b.type, b.horses) === s.key) : undefined;
                return (
                  <div key={s.key} className={`hr-sel ${settled ? (settled.won ? 'won' : 'lost') : ''}`}>
                    <div className="hr-sel-top">
                      <span className="hr-sel-type">{TYPE_LABEL[s.type]}</span>
                      <b className="hr-sel-odds">@ {fmtOdds(s.odds)}</b>
                      {!racing && (
                        <button type="button" className="hr-x" onClick={() => remove(s.key)} aria-label="Remove">
                          <LuX size={14} />
                        </button>
                      )}
                    </div>
                    <div className="hr-sel-name">
                      {s.horses.map((h) => (
                        <Cloth key={h} no={h + 1} small />
                      ))}
                      <span>{selLabel(shown, s)}</span>
                    </div>
                    <div className="hr-sel-stake">
                      <label>
                        $<input inputMode="decimal" value={s.stake} disabled={racing} onChange={(e) => setStake(s.key, e.target.value)} />
                      </label>
                      <span>{settled ? (settled.won ? `Won ${usd(settled.returned)}` : 'Lost') : `Returns ${usd((Number(s.stake) || 0) * s.odds)}`}</span>
                    </div>
                  </div>
                );
              })}
            {list.length > 0 && (
              <div className="hr-slip-total">
                <span>Total stake</span>
                <b>{usd(total)}</b>
                <span>Potential return (all win)</span>
                <b className="win">{usd(potential)}</b>
              </div>
            )}
          </div>
          <ActionBar className={racing ? 'split' : ''}>
            {racing ? (
              <>
                <button className="btn btn-ghost" onClick={() => setSkip((x) => x + 1)}>
                  <LuFastForward size={16} /> Skip
                </button>
                <PlayButton busy onClick={() => {}}>
                  Racing
                </PlayButton>
              </>
            ) : phase === 'result' ? (
              <PlayButton onClick={() => (sfx.click(), nextRace(true))}>Next race {list.length ? `· same bets` : ''}</PlayButton>
            ) : (
              <PlayButton busy={busy} onClick={race} disabled={!list.length || !card}>
                {list.length ? (
                  <>
                    Bet &amp; start race <small className="pb-sub">· {usd(total)}</small>
                  </>
                ) : (
                  'Pick a runner to bet'
                )}
              </PlayButton>
            )}
          </ActionBar>
          <small className="muted">Every price is set at a 97% return. The race card comes from your public client seed and the round number, the result from the provably fair server seed.</small>
        </>
      }
      stage={
        shown ? (
          <div className="horses-stage">
            <div ref={viewRef}>
              <RaceView card={shown} plan={plan} running={racing} finished={phase === 'result'} skip={skip} onFinish={onFinish} onLine={onLine} />
            </div>
            <div className="hr-ticker">
              <span className="hr-mic">🎙</span>
              <div>
                {ticker.length ? (
                  ticker.map((t, i) => (
                    <p key={`${i}-${t}`} className={i === 0 ? 'now' : ''}>
                      {t}
                    </p>
                  ))
                ) : (
                  <p className="now">
                    Race {shown.race} · {shown.runners.length} runners · {shown.distance}m. Favourite: #{favIdx + 1} {shown.runners[favIdx].name} at {fmtOdds(shown.runners[favIdx].win)}.
                  </p>
                )}
              </div>
            </div>
            {showResult && result && (
              <div className="hr-result">
                <button type="button" className="hr-x top" onClick={() => setShowResult(false)} aria-label="Close result">
                  <LuX size={16} />
                </button>
                <div className="hr-result-head">
                  <LuTrophy size={18} /> Race {result.race} result · {fmtTime(result.time)}
                </div>
                <div className="hr-podium">
                  {[1, 0, 2].map((p) => {
                    const i = result.order[p];
                    const r = shown.runners[i];
                    return (
                      <div key={p} className={`hr-pod p${p + 1}`}>
                        <SilksIcon s={r.silks} uid={`pod-${shown.id}-${i}`} />
                        <Cloth no={r.no} small />
                        <b>{r.name}</b>
                        <small>{p === 0 ? `SP ${fmtOdds(r.win)}` : `by ${lengthsText(result.margins[p])}`}</small>
                        <span className="step">{p + 1}</span>
                      </div>
                    );
                  })}
                </div>
                {payout && (
                  <div className={`hr-payout ${net > 0 ? 'win' : 'loss'}`}>
                    {payout.returned > 0 ? `You collect ${usd(payout.returned)}` : 'No winning bets this race'}
                    <small>
                      {' '}
                      · staked {usd(payout.stake)}
                    </small>
                  </div>
                )}
              </div>
            )}
            {past.length > 0 && (
              <div className="hr-past">
                <span>Recent winners</span>
                {past.map((p) => (
                  <em key={p.race} title={p.name}>
                    R{p.race} <Cloth no={p.no} small />
                  </em>
                ))}
              </div>
            )}
            <RaceCardTable card={shown} sels={sels} toggle={toggle} locked={racing || phase === 'result'} result={phase === 'result' ? result : null} />
          </div>
        ) : (
          <div className="horses-stage loading">Loading race card…</div>
        )
      }
    />
  );
}

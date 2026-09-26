import { useEffect, useState } from 'react';
import { LuLightbulb, LuPlus, LuCheck, LuLayers } from 'react-icons/lu';
import { api } from '../lib/api';
import { kickoff, odds as fmtOdds } from '../lib/format';
import { Link } from '../lib/router';
import { useSlip, useToast } from '../lib/state';
import type { SportEvent } from '../lib/types';
import { BackBar } from '../components/Layout';
import { Empty, Skeleton } from '../components/ui';

export interface Tip {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  match: string;
  league: string;
  kickoff: string;
  marketKey: string;
  outcomeId: string;
  pick: string;
  odds: number;
  probability: number;
  reason: string;
}
interface TipsRes {
  day: string;
  tips: Tip[];
  acca: { legs: string[]; odds: number; probability: number } | null;
}

export function useTips() {
  const [d, setD] = useState<TipsRes | null>(null);
  useEffect(() => {
    api<TipsRes>('/tips').then(setD).catch(() => setD({ day: '', tips: [], acca: null }));
  }, []);
  return d;
}

function useAddTip() {
  const slip = useSlip();
  return (t: Tip) => {
    const ev = { id: t.eventId, homeTeam: t.homeTeam, awayTeam: t.awayTeam, sportTitle: t.league } as SportEvent;
    slip.toggle(ev, t.marketKey, { id: t.outcomeId, code: '', name: t.pick, price: t.odds, point: null });
  };
}

export function TipCard({ t }: { t: Tip }) {
  const slip = useSlip();
  const add = useAddTip();
  const on = slip.has(t.outcomeId);
  return (
    <article className="tip-card">
      <div className="tip-top">
        <span className="tip-league ellipsis">{t.league}</span>
        <span className="tip-time">{kickoff(t.kickoff)}</span>
      </div>
      <Link to={`/event/${t.eventId}`} className="tip-match ellipsis">
        {t.match}
      </Link>
      <div className="tip-pick">
        <div>
          <small>Tip</small>
          <b>{t.pick}</b>
        </div>
        <button type="button" className={`tip-odds ${on ? 'on' : ''}`} onClick={() => add(t)}>
          {on ? <LuCheck size={14} /> : <LuPlus size={14} />} {fmtOdds(t.odds)}
        </button>
      </div>
      <div className="tip-prob">
        <i style={{ width: `${t.probability}%` }} />
        <span>{t.probability}% implied chance</span>
      </div>
      <p className="tip-why">{t.reason}</p>
    </article>
  );
}

export function TipsPage() {
  const d = useTips();
  const add = useAddTip();
  const slip = useSlip();
  const toast = useToast();
  const accaTips = d?.acca ? d.tips.filter((t) => d.acca!.legs.includes(t.outcomeId)) : [];
  return (
    <div className="page">
      <BackBar title="Tips of the day" />
      <section className="tips-hero">
        <LuLightbulb size={26} />
        <div>
          <h1>Today's tips</h1>
          <p>Picked every day from real prices across our book — the strongest-rated selections of the next 36 hours. Tips show what the market expects; no result is ever guaranteed.</p>
        </div>
      </section>
      {d === null ? (
        <div className="tips-grid">
          <Skeleton h={180} count={6} />
        </div>
      ) : !d.tips.length ? (
        <Empty title="No tips yet today" text="Tips appear once today's matches are priced. Check back soon." />
      ) : (
        <>
          {d.acca && accaTips.length === 3 && (
            <section className="acca-card">
              <div className="acca-head">
                <LuLayers size={20} />
                <div>
                  <b>Acca of the day</b>
                  <small>3 selections · {d.acca.probability}% combined implied chance</small>
                </div>
                <span className="acca-odds">{fmtOdds(d.acca.odds)}</span>
              </div>
              <ul>
                {accaTips.map((t) => (
                  <li key={t.outcomeId}>
                    <span className="acca-dot" />
                    <div>
                      <b>{t.pick}</b>
                      <small>{t.match}</small>
                    </div>
                    <em>{fmtOdds(t.odds)}</em>
                  </li>
                ))}
              </ul>
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  accaTips.forEach((t) => !slip.has(t.outcomeId) && add(t));
                  slip.setOpen(true);
                  toast('ok', 'Acca added to your betslip');
                }}
              >
                Add acca to betslip
              </button>
            </section>
          )}
          <div className="tips-grid">
            {d.tips.map((t) => (
              <TipCard key={t.outcomeId} t={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

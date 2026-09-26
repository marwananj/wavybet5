import { Router } from 'express';
import { config } from '../config';
import { asyncH } from '../lib/http';
import { prisma } from '../lib/prisma';

/**
 * Daily tips — generated automatically every day from the real prices on our own book.
 * For each upcoming match the fair (margin-free) probability of the main outcomes is computed
 * from the odds; the strongest reasonably-priced pick per match is proposed, the best six
 * become "Tips of the day" and the top three from different matches form the "Acca of the day".
 * They describe what the market expects — not a guarantee — and the page says so.
 */
const r = Router();
let cache: { day: string; at: number; data: unknown } | null = null;

const fair = (prices: number[]) => {
  const inv = prices.map((p) => 1 / p);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
};

r.get(
  '/tips',
  asyncH(async (_req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    if (cache && cache.day === day && Date.now() - cache.at < 30 * 60_000) return res.json(cache.data);
    const now = new Date();
    const events = await prisma.event.findMany({
      where: { status: 'UPCOMING', commenceTime: { gt: new Date(now.getTime() + 10 * 60_000), lt: new Date(now.getTime() + 36 * 3600_000) }, sport: { enabled: true, provider: config.provider } },
      include: { markets: { where: { suspended: false }, include: { outcomes: { where: { active: true, suspended: false } } } } },
      orderBy: { commenceTime: 'asc' },
      take: 400,
    });
    const priority = new Map(config.afPriority.map((id, i) => [`soccer_af_${id}`, i]));
    type Tip = { eventId: string; homeTeam: string; awayTeam: string; match: string; league: string; kickoff: Date; marketKey: string; outcomeId: string; pick: string; odds: number; probability: number; reason: string; score: number };
    const tips: Tip[] = [];
    for (const e of events) {
      const m = (k: string) => e.markets.find((x) => x.key === k);
      const h2h = m('h2h');
      const oc = (mk: typeof h2h, code: string) => mk?.outcomes.find((o) => o.code === code);
      const cands: Omit<Tip, 'score'>[] = [];
      const base = { eventId: e.id, homeTeam: e.homeTeam, awayTeam: e.awayTeam, match: `${e.homeTeam} vs ${e.awayTeam}`, league: e.sportTitle, kickoff: e.commenceTime };
      const h = oc(h2h, 'home'), d = oc(h2h, 'draw'), a = oc(h2h, 'away');
      if (h && d && a) {
        const [ph, pd, pa] = fair([Number(h.price), Number(d.price), Number(a.price)]);
        const fav = ph >= pa ? { o: h, p: ph, team: e.homeTeam } : { o: a, p: pa, team: e.awayTeam };
        if (fav.p >= 0.5 && Number(fav.o.price) >= 1.3)
          cands.push({ ...base, marketKey: 'h2h', outcomeId: fav.o.id, pick: `${fav.team} to win`, odds: Number(fav.o.price), probability: fav.p, reason: `Clear market favourite — the odds give ${fav.team} a ${Math.round(fav.p * 100)}% chance to win.` });
        const dc = m('double_chance');
        const dcCode = ph >= pa ? 'home_draw' : 'draw_away';
        const dco = oc(dc, dcCode);
        const pdc = ph >= pa ? ph + pd : pa + pd;
        if (dco && Number(dco.price) >= 1.25 && fav.p < 0.55)
          cands.push({ ...base, marketKey: 'double_chance', outcomeId: dco.id, pick: dco.name, odds: Number(dco.price), probability: pdc, reason: `${fav.team} are slight favourites; the draw as cover lifts the chance to ${Math.round(pdc * 100)}%.` });
      }
      const tot = m('totals');
      const o25 = oc(tot, 'over_2.5'), u25 = oc(tot, 'under_2.5');
      if (o25 && u25) {
        const [po, pu] = fair([Number(o25.price), Number(u25.price)]);
        if (po >= 0.56) cands.push({ ...base, marketKey: 'totals', outcomeId: o25.id, pick: 'Over 2.5 goals', odds: Number(o25.price), probability: po, reason: `Goals expected — ${Math.round(po * 100)}% implied chance of 3+ goals.` });
        if (pu >= 0.58) cands.push({ ...base, marketKey: 'totals', outcomeId: u25.id, pick: 'Under 2.5 goals', odds: Number(u25.price), probability: pu, reason: `Tight game expected — ${Math.round(pu * 100)}% implied chance of 2 goals or fewer.` });
      }
      const bt = m('btts');
      const by = oc(bt, 'yes'), bn = oc(bt, 'no');
      if (by && bn) {
        const [py] = fair([Number(by.price), Number(bn.price)]);
        if (py >= 0.56) cands.push({ ...base, marketKey: 'btts', outcomeId: by.id, pick: 'Both teams to score', odds: Number(by.price), probability: py, reason: `Both attacks rated — ${Math.round(py * 100)}% implied chance both sides score.` });
      }
      const best = cands.filter((c) => c.odds >= 1.25 && c.odds <= 2.4).sort((x, y) => y.probability - x.probability)[0];
      if (!best) continue;
      const pr = priority.get(e.sportKey);
      const leagueWeight = pr == null ? 0.85 : 1 + Math.max(0, 0.3 - pr * 0.01);
      tips.push({ ...best, score: best.probability * leagueWeight * (e.featured ? 1.1 : 1) });
    }
    tips.sort((a, b) => b.score - a.score);
    const top = tips.slice(0, 8);
    const acca = top.slice(0, 3);
    const data = {
      day,
      generatedAt: new Date(),
      tips: top.map(({ score: _s, ...t }) => ({ ...t, probability: Math.round(t.probability * 1000) / 10 })),
      acca: acca.length === 3 ? { legs: acca.map((t) => t.outcomeId), odds: Math.round(acca.reduce((p, t) => p * t.odds, 1) * 100) / 100, probability: Math.round(acca.reduce((p, t) => p * t.probability, 1) * 1000) / 10 } : null,
    };
    cache = { day, at: Date.now(), data };
    res.json(data);
  })
);

export default r;

import cron from 'node-cron';
import { config } from '../config';
import { feed } from '../services/feed';
import { startLiveJob } from '../services/live';

const running = { odds: false, scores: false };

export function startJobs() {
  if (!config.jobsEnabled) return console.log('[jobs] disabled');
  if (!feed.hasKey) return console.warn(`[jobs] ${feed.name} key missing — odds sync disabled`);
  console.log(`[jobs] feed: ${feed.name} · odds "${feed.oddsCron}" · scores "${feed.scoresCron}"`);

  const run = async (name: 'odds' | 'scores', fn: () => Promise<number>) => {
    if (running[name]) return;
    running[name] = true;
    const t = Date.now();
    try {
      const n = await fn();
      console.log(`[jobs] ${name} ok (${n}) in ${Date.now() - t}ms`);
    } catch (e) {
      console.error(`[jobs] ${name} failed`, e);
    } finally {
      running[name] = false;
    }
  };

  // bootstrap
  (async () => {
    try {
      await feed.syncSports();
    } catch (e) {
      console.error('[jobs] sports sync failed', e);
    }
    await run('odds', feed.syncOdds);
    await run('scores', feed.syncScores);
  })();

  startLiveJob();
  cron.schedule('0 4 * * *', () => feed.syncSports().catch(console.error));
  cron.schedule(feed.oddsCron, () => run('odds', feed.syncOdds));
  cron.schedule(feed.scoresCron, () => run('scores', feed.syncScores));
}

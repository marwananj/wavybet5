import { config } from '../config';
import { afSyncOdds, afSyncScores, afSyncSports } from './apifootball';
import { syncOdds as toSyncOdds, syncScores as toSyncScores, syncSports as toSyncSports } from './odds';

/** Dispatch to whichever feed is configured (ODDS_PROVIDER). */
const af = config.provider === 'apifootball';

export const feed = {
  name: af ? 'API-Football' : 'The Odds API',
  hasKey: af ? !!config.afKey : !!config.oddsApiKey,
  syncSports: af ? afSyncSports : toSyncSports,
  syncOdds: af ? afSyncOdds : toSyncOdds,
  syncScores: af ? afSyncScores : toSyncScores,
  oddsCron: af ? config.afOddsCron : config.oddsSyncCron,
  scoresCron: af ? config.afScoresCron : config.scoresSyncCron,
};

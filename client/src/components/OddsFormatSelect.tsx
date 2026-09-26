import { api } from '../lib/api';
import { getOddsFormat, setOddsFormat, type OddsFormat } from '../lib/format';
import { useAuth } from '../lib/state';
import type { User } from '../lib/types';

export const OPTIONS: [OddsFormat, string, string][] = [
  ['decimal', 'Decimal', '2.50'],
  ['fractional', 'Fractional', '3/2'],
  ['american', 'American', '+150'],
];

export function changeOddsFormat(f: OddsFormat) {
  setOddsFormat(f);
  window.dispatchEvent(new Event('wb-odds'));
}

/** Decimal / Fractional / American switch (saved to the account when logged in) */
export function OddsFormatSelect({ compact }: { compact?: boolean }) {
  const { user, setUser } = useAuth();
  const cur = getOddsFormat();
  const pick = (f: OddsFormat) => {
    changeOddsFormat(f);
    if (user) api<{ user: User }>('/auth/preferences', { body: { oddsFormat: f } }).then((d) => setUser(d.user)).catch(() => {});
  };
  if (compact)
    return (
      <label className="odds-fmt-compact">
        <span>Odds</span>
        <select value={cur} onChange={(e) => pick(e.target.value as OddsFormat)}>
          {OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className="odds-fmt">
      {OPTIONS.map(([v, l, ex]) => (
        <button key={v} type="button" className={cur === v ? 'on' : ''} onClick={() => pick(v)}>
          <b>{l}</b>
          <small>{ex}</small>
        </button>
      ))}
    </div>
  );
}

import { odds } from '../lib/format';

/** odds in the player's chosen display format */
export function OddsText({ odds: o }: { odds: number | string }) {
  return <>{odds(o)}</>;
}

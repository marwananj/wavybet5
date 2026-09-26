import { useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuDownload, LuLink, LuShare2, LuX } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { useSlip, useToast } from '../lib/state';
import type { Pick } from '../lib/types';
import { Spinner } from './ui';

const linkFor = (code: string) => `${window.location.origin}/?slip=${code}`;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers / non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** loads a booking code into the slip (merging with what is already there) */
export function useLoadSlipCode() {
  const slip = useSlip();
  const toast = useToast();
  return async (raw: string) => {
    const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) throw new ApiError(400, 'Enter a booking code');
    const d = await api<{ code: string; picks: Pick[]; available: number }>(`/slips/${code}`);
    if (!d.picks.length) throw new ApiError(404, 'These selections are no longer available');
    const have = new Set(slip.picks.map((p) => p.outcomeId));
    const merged = [...slip.picks, ...d.picks.filter((p) => !have.has(p.outcomeId))].slice(0, 15);
    slip.replaceAll(merged);
    slip.setOpen(true);
    const off = d.picks.length - d.available;
    toast(off ? 'info' : 'ok', `Loaded ${d.picks.length} selection${d.picks.length > 1 ? 's' : ''} from ${d.code}${off ? ` · ${off} no longer available` : ''}`);
    return d;
  };
}

/** "Share" — turns the current slip into a booking code + link */
export function ShareSlip({ onClose }: { onClose: () => void }) {
  const slip = useSlip();
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const ids = slip.picks.map((p) => p.outcomeId).join(',');

  useEffect(() => {
    let alive = true;
    setCode(null);
    setErr(null);
    api<{ code: string }>('/slips', { body: { outcomeIds: slip.picks.map((p) => p.outcomeId) } })
      .then((d) => alive && setCode(d.code))
      .catch((e) => alive && setErr((e as ApiError).message));
    return () => {
      alive = false;
    };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const doCopy = async (what: 'code' | 'link') => {
    if (!code) return;
    if (await copy(what === 'code' ? code : linkFor(code))) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    }
  };
  const text = code ? `🎟️ My WavyBet slip (${slip.picks.length} pick${slip.picks.length > 1 ? 's' : ''}) — code ${code}\n${linkFor(code)}` : '';
  const native = async () => {
    try {
      await navigator.share({ title: 'WavyBet betslip', text, url: code ? linkFor(code) : undefined });
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="share-slip">
      <div className="share-head">
        <b>
          <LuShare2 size={15} /> Share this betslip
        </b>
        <button type="button" onClick={onClose} aria-label="Close">
          <LuX size={16} />
        </button>
      </div>
      {err ? (
        <p className="share-err">{err}</p>
      ) : !code ? (
        <div className="share-loading">
          <Spinner />
        </div>
      ) : (
        <>
          <button type="button" className="share-code" onClick={() => doCopy('code')} title="Copy code">
            <span>{code}</span>
            {copied === 'code' ? <LuCheck size={18} /> : <LuCopy size={18} />}
          </button>
          <div className="share-actions">
            <button type="button" onClick={() => doCopy('link')}>
              {copied === 'link' ? <LuCheck size={15} /> : <LuLink size={15} />} {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="wa">
              WhatsApp
            </a>
            <a href={`https://t.me/share/url?url=${encodeURIComponent(linkFor(code))}&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="tg">
              Telegram
            </a>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button type="button" onClick={native}>
                <LuShare2 size={15} /> More
              </button>
            )}
          </div>
          <small>Friends open the link or type the code in their betslip to load the same picks with live prices.</small>
        </>
      )}
    </div>
  );
}

/** "Have a booking code?" input */
export function LoadCode({ compact }: { compact?: boolean }) {
  const load = useLoadSlipCode();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await load(v);
      setV('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`load-code ${compact ? 'compact' : ''}`}>
      {!compact && <span>Have a booking code?</span>}
      <div className="load-code-row">
        <input
          value={v}
          placeholder="e.g. WB7K2QX9"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setV(e.target.value.toUpperCase().slice(0, 12))}
          onKeyDown={(e) => e.key === 'Enter' && v && go()}
        />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!v || busy} onClick={go}>
          {busy ? <Spinner /> : (
            <>
              <LuDownload size={14} /> Load
            </>
          )}
        </button>
      </div>
      {err && <small className="load-code-err">{err}</small>}
    </div>
  );
}

/** opening a shared link (?slip=CODE) loads the picks automatically */
export function useSlipLinkLoader() {
  const load = useLoadSlipCode();
  const toast = useToast();
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('slip');
    if (!code) return;
    url.searchParams.delete('slip');
    window.history.replaceState(window.history.state, '', url.pathname + (url.search || '') + url.hash);
    load(code).catch((e) => toast('err', (e as ApiError).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

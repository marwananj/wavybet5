import { SUPPORT_EMAIL } from '../lib/site';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LuHeadphones, LuMessageCircle, LuSend, LuX } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { subscribeNamed } from '../lib/live';
import { Link } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import { Spinner } from './ui';

interface Msg {
  id: string;
  user: string;
  staff: boolean;
  tier: string;
  body: string;
  at: string;
}
interface SupportMsg {
  id: string;
  body: string;
  staff: boolean;
  user: string;
  at: string;
}
const TIER_COLOR: Record<string, string> = { bronze: '#cd7f32', silver: '#c0c7d4', gold: '#f5c542', platinum: '#7dd3fc', diamond: '#a78bfa', wavy: '#3ad0ff' };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const FAQ: { q: string; a: string; link?: [string, string] }[] = [
  { q: 'How do I deposit?', a: 'Open Wallet → Deposit, pick a coin, send to the address shown and submit your TXID with the secret code. Deposits are credited after confirmation.', link: ['/wallet', 'Open wallet'] },
  { q: 'How long do withdrawals take?', a: 'Withdrawals are reviewed and sent manually, usually within a few hours. You can follow the status in Wallet → History.', link: ['/wallet', 'Wallet history'] },
  { q: "I didn't get my verification code", a: 'Check your spam folder. You can request a new code every 60 seconds from the verification window.' },
  { q: 'How does the $25 first deposit gift work?', a: 'Your first deposit of $20 or more adds a $25 gift to your balance. Wager it 10× before withdrawing.' },
  { q: 'What is the VIP booster?', a: 'Every $5,000 you wager pays you $20 real balance. Claim it any time from the VIP page.', link: ['/vip', 'Open VIP'] },
  { q: 'How does cash out work?', a: 'Open My Bets: every open single or parlay shows its live cash-out value when all its markets are open.', link: ['/bets', 'My bets'] },
];

function GlobalChat({ active }: { active: boolean }) {
  const { user, openAuth } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [online, setOnline] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api<{ messages: Msg[]; online: number }>('/chat/global')
      .then((d) => {
        setMsgs(d.messages);
        setOnline(d.online);
      })
      .catch(() => setMsgs([]));
    return subscribeNamed('chat', (d: { message?: Msg; deleted?: string }) => {
      if (d.message) setMsgs((m) => (m ? [...m.filter((x) => x.id !== d.message!.id), d.message!].slice(-120) : m));
      if (d.deleted) setMsgs((m) => m?.filter((x) => x.id !== d.deleted) ?? m);
    });
  }, []);
  useEffect(() => {
    if (active) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [msgs?.length, active]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return openAuth('login');
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api('/chat/global', { body: { body } });
      setText('');
    } catch (err) {
      toast('err', (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="chat-online">
        <i className="live-dot" /> {online} online · Be respectful · No links or spam
      </div>
      <div className="chat-list" ref={list}>
        {msgs === null ? (
          <Spinner />
        ) : !msgs.length ? (
          <p className="muted chat-empty">Say hi to the community 👋</p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`chat-msg ${m.staff ? 'staff' : ''} ${user?.username === m.user ? 'me' : ''}`}>
              <span className="chat-user" style={{ color: m.staff ? '#4ade80' : TIER_COLOR[m.tier] }}>
                {m.staff && <em>STAFF</em>}
                {m.user}
              </span>
              <p>{m.body}</p>
              <small>{time(m.at)}</small>
            </div>
          ))
        )}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} placeholder={user ? 'Type a message…' : 'Log in to chat'} maxLength={300} />
        <button className="btn btn-primary" disabled={busy || (!!user && !text.trim())} aria-label="Send">
          {busy ? <Spinner /> : <LuSend size={16} />}
        </button>
      </form>
    </>
  );
}

function Support({ active }: { active: boolean }) {
  const { user, openAuth } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<SupportMsg[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const load = () => user && api<{ messages: SupportMsg[] }>('/chat/support').then((d) => setMsgs(d.messages)).catch(() => {});
  useEffect(() => {
    if (!user) return;
    load();
    return subscribeNamed('support', (d: { threadUserId: string }) => d.threadUserId === user.id && load());
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (active) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [msgs?.length, active, faq]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const d = await api<{ messages: SupportMsg[] }>('/chat/support', { body: { body } });
      setMsgs(d.messages);
      setText('');
    } catch (err) {
      toast('err', (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="chat-list support" ref={list}>
        <div className="sup-intro">
          <LuHeadphones size={22} />
          <div>
            <b>WavyBet Support</b>
            <small>Real agents · we usually reply within minutes</small>
            <small>
              Or e-mail us: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </small>
          </div>
        </div>
        <div className="sup-faq">
          {FAQ.map((f, i) => (
            <button key={i} type="button" className={faq === i ? 'on' : ''} onClick={() => setFaq(faq === i ? null : i)}>
              {f.q}
            </button>
          ))}
        </div>
        {faq != null && (
          <div className="chat-msg staff bot">
            <span className="chat-user" style={{ color: '#4ade80' }}>
              <em>HELP</em> Quick answer
            </span>
            <p>{FAQ[faq].a}</p>
            {FAQ[faq].link && (
              <Link to={FAQ[faq].link![0]} className="sup-link">
                {FAQ[faq].link![1]} →
              </Link>
            )}
          </div>
        )}
        {!user ? (
          <p className="muted chat-empty">
            <button className="link-btn" onClick={() => openAuth('login')}>
              Log in
            </button>{' '}
            to talk to an agent.
          </p>
        ) : (
          msgs?.map((m) => (
            <div key={m.id} className={`chat-msg ${m.staff ? 'staff' : 'me'}`}>
              <span className="chat-user" style={{ color: m.staff ? '#4ade80' : '#7ee3ff' }}>
                {m.staff && <em>AGENT</em>}
                {m.user}
              </span>
              <p>{m.body}</p>
              <small>{time(m.at)}</small>
            </div>
          ))
        )}
      </div>
      {user && (
        <form className="chat-input" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} placeholder="Describe your issue…" />
          <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label="Send">
            {busy ? <Spinner /> : <LuSend size={16} />}
          </button>
        </form>
      )}
    </>
  );
}

/** Slide-in chat: community chat + live customer support. */
export function ChatPanel({ open, onClose, initialTab = 'chat' }: { open: boolean; onClose: () => void; initialTab?: 'chat' | 'support' }) {
  const [tab, setTab] = useState<'chat' | 'support'>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab, open]);
  return (
    <>
      <div className={`chat-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`chat-panel ${open ? 'open' : ''}`} aria-label="Chat and support">
        <div className="chat-head">
          <div className="seg seg-sm">
            <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
              <LuMessageCircle size={14} /> Chat
            </button>
            <button className={tab === 'support' ? 'on' : ''} onClick={() => setTab('support')}>
              <LuHeadphones size={14} /> Support
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close chat">
            <LuX size={18} />
          </button>
        </div>
        <div className={`chat-pane ${tab === 'chat' ? '' : 'hidden'}`}>
          <GlobalChat active={open && tab === 'chat'} />
        </div>
        <div className={`chat-pane ${tab === 'support' ? '' : 'hidden'}`}>
          <Support active={open && tab === 'support'} />
        </div>
      </aside>
    </>
  );
}

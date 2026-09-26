import { useEffect, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { LuArrowDownToLine, LuArrowUpFromLine, LuCheck, LuCopy, LuHistory, LuWallet } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { dateTime, usd } from '../lib/format';
import { useRouter } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import type { Tx } from '../lib/types';
import { BackBar } from '../components/Layout';
import { Empty, Skeleton, Spinner } from '../components/ui';
import { FirstDepositPoster } from '../components/FirstDepositPromo';

interface Currency {
  code: string;
  name: string;
  network: string;
  address?: string;
  memo?: string | null;
}
interface WalletInfo {
  mode: 'manual' | 'nowpayments';
  requiresCode: boolean;
  currencies: Currency[];
  minDeposit: number;
  minWithdrawal: number;
}
interface Deposit {
  id: string;
  amount: string;
  currency: string;
  address: string;
  payAmount: number;
  extraId: string | null;
  status: string;
}

function useCurrencies() {
  const [d, setD] = useState<WalletInfo | null>(null);
  useEffect(() => {
    api('/wallet/currencies').then(setD).catch(() => {});
  }, []);
  return d;
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      aria-label="Copy"
    >
      {ok ? <LuCheck size={16} /> : <LuCopy size={16} />}
    </button>
  );
}

function CoinPicker({ list, value, onChange }: { list: Currency[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="coin-grid">
      {list.map((c) => (
        <button type="button" key={c.code} className={`coin${value === c.code ? ' on' : ''}`} onClick={() => onChange(c.code)}>
          <span className="coin-sym">{c.code.replace(/(trc20|erc20|bsc)$/, '').toUpperCase()}</span>
          <small>{c.network}</small>
        </button>
      ))}
    </div>
  );
}

const coinSym = (code: string) => code.replace(/(trc20|erc20|bep20|bsc)$/, '').toUpperCase();

function SecretCode({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>Secret code</span>
      <input type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter your secret code" required />
    </label>
  );
}

/** Manual mode: pay to our wallet, submit the TXID, admin approves. */
function ManualDeposit({ cur }: { cur: WalletInfo }) {
  const { user } = useAuth();
  const [currency, setCurrency] = useState(cur.currencies[0]?.code ?? '');
  const [amount, setAmount] = useState('50');
  const [txHash, setTxHash] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: string; currency: string } | null>(null);

  if (!cur.currencies.length)
    return <Empty title="Deposits are not open yet" text="No deposit wallets are configured. Please contact support." />;

  const coin = cur.currencies.find((c) => c.code === currency) ?? cur.currencies[0];
  const selfExcluded = user?.selfExcludedUntil && new Date(user.selfExcludedUntil) > new Date();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/wallet/deposit', { body: { amount: Number(amount), currency: coin.code, txHash: txHash.trim(), ...(cur.requiresCode ? { code } : {}) } });
      setDone({ amount, currency: coin.code });
      setTxHash('');
      setCode('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="deposit-box">
        <div className="slip-empty">
          <div className="slip-success">✓</div>
          <p>
            <b>Deposit submitted</b>
          </p>
          <span>
            {usd(done.amount)} in {coinSym(done.currency)} is waiting for confirmation. Your balance updates as soon as it's approved — you can follow it under History.
          </span>
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => setDone(null)}>
          New deposit
        </button>
      </div>
    );

  return (
    <form onSubmit={submit} className="wallet-form">
      <span className="field-label">1 · Choose coin</span>
      <CoinPicker list={cur.currencies} value={coin.code} onChange={setCurrency} />

      <span className="field-label">2 · Send to this address</span>
      <div className="deposit-box">
        <div className="qr">
          <QRCodeSVG value={coin.address ?? ''} size={160} bgColor="#ffffff" fgColor="#0b0e1f" includeMargin />
        </div>
        <div className="copy-field">
          <code>{coin.address}</code>
          <Copy text={coin.address ?? ''} />
        </div>
        {coin.memo && (
          <label className="field" style={{ marginTop: 10 }}>
            <span>Memo / Tag (required)</span>
            <div className="copy-field">
              <code>{coin.memo}</code>
              <Copy text={coin.memo} />
            </div>
          </label>
        )}
        <div className="notice">
          Only send <b>{coin.name}</b> on the <b>{coin.network}</b> network. Other coins or networks will be lost.
        </div>
      </div>

      <span className="field-label">3 · Confirm your payment</span>
      <label className="field">
        <span>Amount sent (USD value)</span>
        <div className="amount-input">
          <b>$</b>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} required />
        </div>
        <small>Minimum {usd(cur.minDeposit)}</small>
      </label>
      <label className="field">
        <span>Transaction hash (TXID)</span>
        <input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="Paste the TXID from your wallet" required minLength={10} />
      </label>
      {cur.requiresCode && <SecretCode value={code} onChange={setCode} />}
      {err && <div className="form-error">{err}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || !!selfExcluded}>
        {busy ? <Spinner /> : selfExcluded ? 'Self-excluded' : 'I have sent the payment'}
      </button>
    </form>
  );
}

function DepositTab() {
  const cur = useCurrencies();
  if (cur?.mode === 'manual') return <ManualDeposit cur={cur} />;
  return <GatewayDeposit cur={cur} />;
}

function GatewayDeposit({ cur }: { cur: WalletInfo | null }) {
  const { user, reloadUser } = useAuth();
  const toast = useToast();
  const [currency, setCurrency] = useState('usdttrc20');
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dep, setDep] = useState<Deposit | null>(null);
  const [status, setStatus] = useState<string>('waiting');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (cur && !cur.currencies.some((c) => c.code === currency)) setCurrency(cur.currencies[0]?.code ?? '');
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dep) return;
    const t = setInterval(async () => {
      const d = await api<{ deposit: { status: string; providerStatus: string | null } }>(`/wallet/deposit/${dep.id}`).catch(() => null);
      if (!d) return;
      setStatus(d.deposit.providerStatus ?? d.deposit.status.toLowerCase());
      if (d.deposit.status === 'COMPLETED') {
        clearInterval(t);
        toast('ok', 'Deposit credited to your balance');
        reloadUser();
      } else if (d.deposit.status !== 'PENDING') clearInterval(t);
    }, 15_000);
    return () => clearInterval(t);
  }, [dep?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const d = await api<{ deposit: Deposit }>('/wallet/deposit', { body: { amount: Number(amount), currency, ...(cur?.requiresCode ? { code } : {}) } });
      setDep(d.deposit);
      setStatus(d.deposit.status);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (!cur) return <Skeleton h={260} count={1} />;

  if (dep) {
    const coin = cur.currencies.find((c) => c.code === dep.currency);
    return (
      <div className="deposit-box">
        <div className="dep-status">
          <span className={`dot dot-${status}`} />
          {status === 'waiting' ? 'Waiting for payment' : status === 'confirming' ? 'Confirming on the blockchain' : status === 'finished' || status === 'completed' ? 'Credited' : status}
        </div>
        <div className="qr">
          <QRCodeSVG value={dep.address} size={168} bgColor="#ffffff" fgColor="#0b0e1f" includeMargin />
        </div>
        <p className="dep-send">
          Send exactly <b>{dep.payAmount} {dep.currency.replace(/(trc20|erc20|bsc)$/, '').toUpperCase()}</b> on <b>{coin?.network}</b>
        </p>
        <label className="field">
          <span>Deposit address</span>
          <div className="copy-field">
            <code>{dep.address}</code>
            <Copy text={dep.address} />
          </div>
        </label>
        {dep.extraId && (
          <label className="field">
            <span>Memo / Tag (required)</span>
            <div className="copy-field">
              <code>{dep.extraId}</code>
              <Copy text={dep.extraId} />
            </div>
          </label>
        )}
        <div className="notice">
          {usd(dep.amount)} will be credited after network confirmation. Only send {coin?.name} on the {coin?.network} network — other coins will be lost.
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => setDep(null)}>
          New deposit
        </button>
      </div>
    );
  }

  const selfExcluded = user?.selfExcludedUntil && new Date(user.selfExcludedUntil) > new Date();
  return (
    <form onSubmit={submit} className="wallet-form">
      <span className="field-label">Choose coin</span>
      <CoinPicker list={cur.currencies} value={currency} onChange={setCurrency} />
      <label className="field">
        <span>Amount (USD)</span>
        <div className="amount-input">
          <b>$</b>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <small>Minimum {usd(cur.minDeposit)}</small>
      </label>
      <div className="quick-stakes">
        {[20, 50, 100, 250, 500].map((v) => (
          <button type="button" key={v} onClick={() => setAmount(String(v))}>
            ${v}
          </button>
        ))}
      </div>
      {cur.requiresCode && <SecretCode value={code} onChange={setCode} />}
      {err && <div className="form-error">{err}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || !!selfExcluded}>
        {busy ? <Spinner /> : selfExcluded ? 'Self-excluded' : 'Get deposit address'}
      </button>
    </form>
  );
}

function WithdrawTab() {
  const cur = useCurrencies();
  const { user, setBalance, reloadUser } = useAuth();
  const toast = useToast();
  const [currency, setCurrency] = useState('usdttrc20');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [extraId, setExtraId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (cur && !cur.currencies.some((c) => c.code === currency)) setCurrency(cur.currencies[0]?.code ?? '');
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/wallet/withdraw', { body: { amount: Number(amount), currency, address, ...(extraId ? { extraId } : {}), ...(cur?.requiresCode ? { code } : {}) } });
      setCode('');
      setBalance(String(Number(user!.balance) - Number(amount)));
      toast('ok', 'Withdrawal requested — we will process it shortly');
      setAmount('');
      setAddress('');
      reloadUser();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  if (!cur) return <Skeleton h={260} count={1} />;
  return (
    <form onSubmit={submit} className="wallet-form">
      <div className="avail">
        <span>Available</span>
        <b>{usd(user?.balance)}</b>
      </div>
      <span className="field-label">Receive in</span>
      <CoinPicker list={cur.currencies} value={currency} onChange={setCurrency} />
      <label className="field">
        <span>Your {cur.currencies.find((c) => c.code === currency)?.network} address</span>
        <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="Paste wallet address" required />
      </label>
      {['xrp', 'xlm', 'eos', 'ton', 'bnbmainnet'].includes(currency) && (
        <label className="field">
          <span>Memo / Tag</span>
          <input value={extraId} onChange={(e) => setExtraId(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Amount (USD)</span>
        <div className="amount-input">
          <b>$</b>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} required />
          <button type="button" className="max-btn" onClick={() => setAmount(String(Math.floor(Number(user?.balance ?? 0) * 100) / 100))}>
            MAX
          </button>
        </div>
        <small>Minimum {usd(cur.minWithdrawal)} · Network fee is deducted from the crypto amount</small>
      </label>
      {cur.requiresCode && <SecretCode value={code} onChange={setCode} />}
      {err && <div className="form-error">{err}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? <Spinner /> : 'Request withdrawal'}
      </button>
    </form>
  );
}

const TX_LABEL: Record<Tx['type'], string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  BET_STAKE: 'Bet placed',
  BET_PAYOUT: 'Bet won',
  BET_REFUND: 'Bet refund',
  ADJUSTMENT: 'Adjustment',
  CASINO_BET: 'Casino bet',
  CASINO_WIN: 'Casino win',
  BONUS: 'Bonus 🎁',
};

function HistoryTab() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Tx[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const toast = useToast();
  const { reloadUser } = useAuth();
  const load = (reset = true) =>
    api<{ items: Tx[]; nextCursor: string | null }>(`/wallet/transactions?${new URLSearchParams({ ...(filter ? { type: filter } : {}), ...(!reset && cursor ? { cursor } : {}) })}`).then((d) => {
      setItems((x) => (reset ? d.items : [...(x ?? []), ...d.items]));
      setCursor(d.nextCursor);
    });
  useEffect(() => {
    setItems(null);
    load();
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async (id: string) => {
    try {
      await api(`/wallet/withdraw/${id}/cancel`, { method: 'POST' });
      toast('ok', 'Withdrawal cancelled and refunded');
      reloadUser();
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };

  return (
    <div>
      <div className="chips">
        {[
          ['', 'All'],
          ['DEPOSIT', 'Deposits'],
          ['WITHDRAWAL', 'Withdrawals'],
          ['BET_STAKE', 'Bets'],
          ['BET_PAYOUT', 'Wins'],
          ['CASINO_BET', 'Casino'],
        ].map(([k, l]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {items === null ? (
        <Skeleton h={60} count={5} />
      ) : items.length === 0 ? (
        <Empty icon={<LuHistory size={30} />} title="No transactions yet" />
      ) : (
        <div className="tx-list">
          {items.map((t) => {
            const amt = Number(t.amount);
            return (
              <div key={t.id} className="tx">
                <div className={`tx-icon ${amt >= 0 ? 'in' : 'out'}`}>{amt >= 0 ? <LuArrowDownToLine size={16} /> : <LuArrowUpFromLine size={16} />}</div>
                <div className="tx-main">
                  <b>
                    {TX_LABEL[t.type]}
                    {t.cryptoCurrency && <em> · {t.cryptoCurrency.toUpperCase()}</em>}
                  </b>
                  <small>
                    {dateTime(t.createdAt)}
                    {t.txHash && (
                      <>
                        {' '}
                        · <code title={t.txHash}>{t.txHash.slice(0, 10)}…</code>
                      </>
                    )}
                    {t.note && t.type !== 'BET_STAKE' && <> · {t.note}</>}
                  </small>
                </div>
                <div className="tx-right">
                  <b className={amt >= 0 ? 'win' : ''}>
                    {amt >= 0 ? '+' : '−'}
                    {usd(Math.abs(amt))}
                  </b>
                  <span className={`status-pill st-${t.status.toLowerCase()}`}>{t.status.toLowerCase()}</span>
                  {t.type === 'WITHDRAWAL' && t.status === 'PENDING' && !t.providerId && (
                    <button className="link-btn" onClick={() => cancel(t.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {cursor && (
            <button className="btn btn-ghost btn-block" onClick={() => load(false)}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function WalletPage() {
  const { user, ready, openAuth } = useAuth();
  const { search, navigate } = useRouter();
  const tab = search.get('tab') ?? 'deposit';
  if (ready && !user)
    return (
      <div className="page">
        <BackBar title="Wallet" />
        <Empty icon={<LuWallet size={34} />} title="Log in to open your wallet" action={<button className="btn btn-primary" onClick={() => openAuth('login')}>Log in</button>} />
      </div>
    );
  return (
    <div className="page page-narrow">
      <BackBar title="Wallet" />
      <div className="wallet-card">
        <small>Balance</small>
        <b>{usd(user?.balance)}</b>
        {Number(user?.bonusWagerLeft ?? 0) > 0 && (
          <span className="bonus-lock">
            🎁 Wager {usd(user?.bonusWagerLeft)} more to unlock withdrawals (first deposit gift)
          </span>
        )}
      </div>
      {tab === 'deposit' && !user?.firstDepositBonusClaimed && <FirstDepositPoster compact />}
      <div className="seg">
        {[
          ['deposit', 'Deposit'],
          ['withdraw', 'Withdraw'],
          ['history', 'History'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => navigate(`/wallet?tab=${k}`, true)}>
            {l}
          </button>
        ))}
      </div>
      {user?.emailVerified === false ? (
        <div className="panel">
          <Empty title="Verify your e-mail first" text="Deposits and withdrawals unlock once your e-mail is confirmed." action={<button className="btn btn-primary" onClick={() => openAuth('verify')}>Enter code</button>} />
        </div>
      ) : (
        <div className="panel">{tab === 'deposit' ? <DepositTab /> : tab === 'withdraw' ? <WithdrawTab /> : <HistoryTab />}</div>
      )}
    </div>
  );
}

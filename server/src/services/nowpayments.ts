import crypto from 'crypto';
import { authenticator } from 'otplib';
import { config } from '../config';
import { HttpError } from '../lib/http';

/** Thin client for the NOWPayments REST API (https://documenter.getpostman.com/view/7907941/2s93JusNJt). */
async function np<T>(path: string, init: RequestInit & { auth?: string } = {}): Promise<T> {
  if (!config.npApiKey) throw new HttpError(503, 'Crypto payments are not configured yet');
  const headers: Record<string, string> = { 'x-api-key': config.npApiKey, 'Content-Type': 'application/json' };
  if (init.auth) headers.Authorization = `Bearer ${init.auth}`;
  const res = await fetch(`${config.npBase}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    console.error('[nowpayments]', path, res.status, data);
    throw new HttpError(502, data?.message ?? 'Payment provider error');
  }
  return data as T;
}

export interface NpPayment {
  payment_id: string | number;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  payin_extra_id?: string | null;
  expiration_estimate_date?: string;
}

export const nowpayments = {
  createPayment(body: { price_amount: number; pay_currency: string; order_id: string; order_description: string }) {
    return np<NpPayment>('/payment', {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        price_currency: 'usd',
        ipn_callback_url: `${config.publicApiUrl}/api/wallet/ipn`,
        is_fixed_rate: false,
        is_fee_paid_by_user: false,
      }),
    });
  },

  getPayment(id: string) {
    return np<NpPayment>(`/payment/${id}`);
  },

  async minAmount(currency: string) {
    const d = await np<{ min_amount: number; fiat_equivalent?: number }>(
      `/min-amount?currency_from=${currency}&currency_to=usd&fiat_equivalent=usd`
    );
    return d;
  },

  async estimate(amountUsd: number, currency: string) {
    const d = await np<{ estimated_amount: string | number }>(
      `/estimate?amount=${amountUsd}&currency_from=usd&currency_to=${currency}`
    );
    return Number(d.estimated_amount);
  },

  /** Mass payout: requires account email/password JWT, then 2FA verification. */
  async createPayout(address: string, currency: string, amount: number, extraId?: string) {
    const { token } = await np<{ token: string }>('/auth', {
      method: 'POST',
      body: JSON.stringify({ email: config.npEmail, password: config.npPassword }),
    });
    const payout = await np<{ id: string; withdrawals: { id: string; status: string }[] }>('/payout', {
      method: 'POST',
      auth: token,
      body: JSON.stringify({
        ipn_callback_url: `${config.publicApiUrl}/api/wallet/ipn-payout`,
        withdrawals: [{ address, currency, amount, ...(extraId ? { extra_id: extraId } : {}) }],
      }),
    });
    if (config.np2faSecret) {
      const code = authenticator.generate(config.np2faSecret);
      await np(`/payout/${payout.id}/verify`, { method: 'POST', auth: token, body: JSON.stringify({ verification_code: code }) });
    }
    return payout;
  },

  /** Verify x-nowpayments-sig: HMAC-SHA512 of the JSON body with keys sorted recursively. */
  verifyIpn(body: unknown, signature: string | undefined) {
    if (!config.npIpnSecret || !signature) return false;
    const sorted = JSON.stringify(sortKeys(body));
    const hmac = crypto.createHmac('sha512', config.npIpnSecret).update(sorted).digest('hex');
    const a = Buffer.from(hmac);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
};

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v as object)
      .sort()
      .reduce((acc, k) => {
        (acc as Record<string, unknown>)[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return v;
}

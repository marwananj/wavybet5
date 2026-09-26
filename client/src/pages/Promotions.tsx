import { useEffect, useState } from 'react';
import { LuCrown, LuHeadphones, LuLightbulb, LuRotateCcw, LuTrophy, LuUsers, LuGift } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { Link } from '../lib/router';
import { BackBar, openChat } from '../components/Layout';
import { FirstDepositPoster } from '../components/FirstDepositPromo';

export function PromotionsPage() {
  const [info, setInfo] = useState<{ step: number; reward: number; firstDeposit: { bonus: number; min: number; wagerX: number } } | null>(null);
  useEffect(() => {
    api('/vip/info').then(setInfo).catch(() => {});
  }, []);
  return (
    <div className="page">
      <BackBar title="Promotions" />
      <FirstDepositPoster amount={info?.firstDeposit?.bonus ?? 25} min={info?.firstDeposit?.min ?? 20} />
      <div className="promo-grid">
        <Link to="/vip" className="promo-card vip">
          <LuCrown size={26} />
          <b>VIP Booster</b>
          <span>
            {usd(info?.reward ?? 20)} real balance for every {usd(info?.step ?? 5000)} you wager — casino or sports.
          </span>
        </Link>
        <Link to="/rewards" className="promo-card spin">
          <LuRotateCcw size={26} />
          <b>Daily wheel</b>
          <span>A free spin every day — win up to $25.</span>
        </Link>
        <Link to="/rewards" className="promo-card cash">
          <LuGift size={26} />
          <b>Weekly cashback</b>
          <span>5% of last week's net losses back every Monday, no wagering.</span>
        </Link>
        <Link to="/tournament" className="promo-card race">
          <LuTrophy size={26} />
          <b>Weekly race</b>
          <span>Top 10 wagerers share the prize pool every Sunday.</span>
        </Link>
        <Link to="/referral" className="promo-card refer">
          <LuUsers size={26} />
          <b>Refer &amp; earn</b>
          <span>Earn a commission on every bet your friends place — for life.</span>
        </Link>
        <Link to="/tips" className="promo-card tips">
          <LuLightbulb size={26} />
          <b>Tips of the day</b>
          <span>Daily picks and an acca built from the strongest prices on the board.</span>
        </Link>
        <button type="button" className="promo-card support" onClick={() => openChat('support')}>
          <LuHeadphones size={26} />
          <b>24/7 live support</b>
          <span>Questions about deposits, withdrawals or bonuses? Chat with an agent.</span>
        </button>
      </div>
      {info?.firstDeposit && (
        <section className="promo-terms">
          <h4>Terms</h4>
          <ul>
            <li>First deposit gift: {usd(info.firstDeposit.bonus)} once per player, on the first deposit of {usd(info.firstDeposit.min)} or more.</li>
            <li>The gift must be wagered {info.firstDeposit.wagerX}× ({usd(info.firstDeposit.bonus * info.firstDeposit.wagerX)}) before a withdrawal can be requested.</li>
            <li>VIP booster rewards have no wagering requirement and can be withdrawn.</li>
            <li>One account per person. Bonus abuse or multiple accounts void all bonuses.</li>
          </ul>
        </section>
      )}
    </div>
  );
}

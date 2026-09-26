/* Verification e-mail (same design as the EmailJS template) — mobile-first, inline styles. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function verificationHtml(username: string, code: string, minutes: number, site: string) {
  const host = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b0e17;">
<style>
  @media only screen and (max-width:480px) {
    .wb-outer { padding:12px 6px !important; }
    .wb-pad { padding-left:18px !important; padding-right:18px !important; }
    .wb-logo { font-size:26px !important; }
    .wb-hi { font-size:18px !important; }
    .wb-code { font-size:30px !important; letter-spacing:6px !important; padding:14px 18px !important; }
    .wb-gift-title { font-size:23px !important; }
    .wb-btn { display:block !important; padding:14px 10px !important; }
    .wb-perk { display:block !important; width:100% !important; padding:7px 0 !important; }
  }
</style>
<div style="margin:0;padding:0;background:#0b0e17;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wb-outer" style="background:#0b0e17;padding:24px 10px;font-family:Arial,Helvetica,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#141a2b;border-radius:18px;overflow:hidden;border:1px solid #232c45;">

  <!-- header -->
  <tr><td align="center" class="wb-pad" style="background-color:#1e5bff;background-image:linear-gradient(135deg,#1e5bff,#3ad0ff);padding:24px 24px;">
    <div class="wb-logo" style="font-size:30px;font-weight:900;color:#ffffff;letter-spacing:1px;line-height:1.2;">wavy<span style="color:#0b0e17;">bet</span></div>
    <div style="font-size:12px;color:#e8f4ff;margin-top:6px;">Sports · Live betting · Wavy Originals</div>
  </td></tr>

  <!-- code -->
  <tr><td class="wb-pad" style="padding:28px 28px 8px;color:#e6ebf5;">
    <div class="wb-hi" style="font-size:20px;font-weight:700;color:#ffffff;">Hi ${esc(username)} 👋</div>
    <p style="font-size:15px;line-height:1.6;color:#b8c1d9;margin:10px 0 20px;">Welcome to WavyBet! Enter this code on the site to activate your account and start playing.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
      <tr><td align="center" class="wb-code" style="background:#0b0e17;border:2px dashed #3ad0ff;border-radius:14px;padding:16px 26px;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:900;letter-spacing:10px;color:#3ad0ff;white-space:nowrap;">${code}</td></tr>
    </table>
    <p style="text-align:center;font-size:13px;color:#8a94ad;margin:12px 0 0;">⏱ Expires in <b style="color:#ffffff;">${minutes} minutes</b></p>
  </td></tr>

  <!-- gift -->
  <tr><td class="wb-pad" style="padding:24px 28px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#3b1d7a;background-image:linear-gradient(135deg,#3b1d7a,#1e5bff);border-radius:16px;">
      <tr><td align="center" style="padding:22px 16px;">
        <div style="font-size:40px;line-height:1;">🎁</div>
        <div style="display:inline-block;margin-top:10px;background:#ffd24a;color:#1a1300;font-size:11px;font-weight:900;letter-spacing:1.5px;padding:4px 10px;border-radius:20px;">WELCOME GIFT</div>
        <div class="wb-gift-title" style="font-size:26px;font-weight:900;color:#ffffff;margin-top:10px;line-height:1.2;">Get <span style="color:#ffd24a;">$25 FREE</span></div>
        <p style="font-size:14px;line-height:1.5;color:#e2e6ff;margin:8px 0 16px;">Hurry up to your gift! Make your first deposit of $20 or more and we add <b>$25</b> to your balance instantly.</p>
        <a href="${site}/wallet" class="wb-btn" style="display:inline-block;background:#ffd24a;color:#1a1300;font-size:15px;font-weight:800;text-decoration:none;padding:13px 30px;border-radius:12px;text-align:center;">Claim my $25 →</a>
      </td></tr>
    </table>
  </td></tr>

  <!-- perks -->
  <tr><td class="wb-pad" style="padding:16px 28px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:1.45;color:#b8c1d9;">
      <tr>
        <td align="center" width="33%" class="wb-perk" style="padding:8px 4px;">👑<br><b style="color:#fff;">VIP Booster</b><br>$20 every $5,000 wagered</td>
        <td align="center" width="33%" class="wb-perk" style="padding:8px 4px;">⚽<br><b style="color:#fff;">Live betting</b><br>Cash out &amp; Bet Builder</td>
        <td align="center" width="33%" class="wb-perk" style="padding:8px 4px;">🎰<br><b style="color:#fff;">Wavy Originals</b><br>Provably fair games</td>
      </tr>
    </table>
  </td></tr>

  <!-- footer -->
  <tr><td class="wb-pad" style="padding:16px 28px 24px;border-top:1px solid #232c45;">
    <p style="font-size:12px;line-height:1.5;color:#6f7a95;margin:0;">Didn't create a WavyBet account? Just ignore this email. Never share your code with anyone, including WavyBet staff. Questions? <a href="mailto:wavybet@gmail.com" style="color:#3ad0ff;text-decoration:none;">wavybet@gmail.com</a></p>
    <p style="font-size:11px;line-height:1.5;color:#58627c;margin:10px 0 0;">18+ only. The gift must be wagered 10× before withdrawal. Please play responsibly.<br>© WavyBet · <a href="${site}" style="color:#3ad0ff;text-decoration:none;">${host}</a></p>
  </td></tr>

</table>
</td></tr>
</table>
</div>
</body></html>`;
}

export const verificationText = (username: string, code: string, minutes: number) =>
  `Hi ${username},\n\nYour WavyBet verification code is ${code} (expires in ${minutes} minutes).\n\nWelcome gift: make your first deposit of $20 or more and get $25 free.\n\nIf you didn't create a WavyBet account, ignore this e-mail.`;

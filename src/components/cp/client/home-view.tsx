'use client';

// ============================================================
// Coin Private: Home / Portfolio
// Big balance, portfolio area chart, quick actions, holdings,
// and a "More you can do" section (screenshot 5 inspiration).
// ============================================================
import { useMemo, useState } from 'react';
import { useUI } from '@/lib/store';
import { useAuth } from '@/lib/store';
import { useFetch, usePortfolio, usePrices } from '@/hooks/use-cp-data';
import {
  AssetIcon, PctBadge, PriceText, SectionHeader, SkeletonBlock,
  EmptyState, BalanceDisplay, LiveBadge,
} from '@/components/cp/primitives';
import { fmtUsd, fmtCrypto } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ArrowDownToLine, ArrowUpFromLine, Send, QrCode, ArrowLeftRight,
  ChevronRight, LineChart as ChartIcon, Wallet, Eye, EyeOff, Gift, ShieldCheck, X,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

const RANGES = [
  { key: '1H', label: '1H' }, { key: '1D', label: '1D' }, { key: '1W', label: '1W' },
  { key: '1M', label: '1M' }, { key: '1Y', label: '1Y' }, { key: 'ALL', label: 'All' },
];

export function HomeView() {
  const { navigate } = useUI();
  const { user } = useAuth();
  const { portfolio, loading } = usePortfolio();
  const { quotes, provider, updatedAt } = usePrices();
  const { data: withdrawalNoticeData, reload: reloadWithdrawalNotice } = useFetch<{ notice: { id: string; createdAt: string } | null }>('/api/withdrawal-notice', [portfolio?.updatedAt]);
  const [range, setRange] = useState('1D');
  const [hidden, setHidden] = useState(false);
  const [dismissingNotice, setDismissingNotice] = useState(false);

  const chartData = useMemo(() => {
    if (!portfolio?.spark?.length) return [];
    const base = portfolio.totalUsd || 10000;
    const first = portfolio.spark[0] || base;
    return portfolio.spark.map((p, i) => ({
      x: i,
      v: base - (first - p) * (base / Math.max(first, 1)) * 0.15,
    }));
  }, [portfolio]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  if (loading && !portfolio) {
    return (
      <div className="space-y-5">
        <SkeletonBlock className="h-8 w-44" />
        <SkeletonBlock className="h-12 w-64" />
        <SkeletonBlock className="h-56 w-full" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    );
  }

  const total = portfolio?.totalUsd ?? 0;
  const change = portfolio?.change24hUsd ?? 0;
  const changePct = portfolio?.change24hPct ?? 0;
  const up = change >= 0;
  const match = portfolio?.welcomeMatch;
  const matchProgress = match ? Math.min(100, (match.streakDays / Math.max(match.requiredDays, 1)) * 100) : 0;
  const matchUnlockDate = match?.unlockAt
    ? new Date(match.unlockAt).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  async function dismissWithdrawalNotice() {
    if (dismissingNotice) return;
    setDismissingNotice(true);
    try {
      const res = await fetch('/api/withdrawal-notice', { method: 'DELETE' });
      if (res.ok) await reloadWithdrawalNotice();
    } finally {
      setDismissingNotice(false);
    }
  }

  return (
    <div className="space-y-7">
      {/* ---------- Greeting + balance ---------- */}
      <section>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[14px] text-muted-foreground">Good to see you, {firstName}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className={cn('text-[34px] md:text-[40px] leading-none font-semibold nums tracking-tight', hidden && 'blur-[10px] select-none')}>
                {fmtUsd(total)}
              </span>
              <button
                onClick={() => setHidden(!hidden)}
                className="p-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground"
                aria-label={hidden ? 'Show balance' : 'Hide balance'}
              >
                {hidden ? <Eye className="w-4.5 h-4.5" /> : <EyeOff className="w-4.5 h-4.5" />}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <PctBadge value={changePct} />
              <span className={cn('text-[13.5px] nums', up ? 'text-up' : 'text-destructive')}>
                {up ? '+' : ''}{fmtUsd(change)} <span className="text-muted-foreground">past 24h</span>
              </span>
            </div>
          </div>
          <span className="hidden md:inline-flex"><LiveBadge provider={provider} updatedAt={updatedAt} /></span>
        </div>

        {withdrawalNoticeData?.notice && (
          <div className="mt-5 relative rounded-2xl border border-warn/25 bg-warn/8 px-4 py-4 pr-11">
            <button
              type="button"
              onClick={dismissWithdrawalNotice}
              disabled={dismissingNotice}
              className="absolute right-3 top-3 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              aria-label="Dismiss withdrawal notice"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="text-[14.5px] font-semibold text-foreground">Withdrawal currently unavailable</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-1.5 max-w-[680px]">
              Your balance has exceeded the <span className="font-medium text-foreground">$5,000 withdrawal threshold</span> for this account level. Once this threshold is crossed, withdrawals remain unavailable until additional balance is added to the account.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-3 max-w-[420px]">
              <div className="rounded-xl bg-background/55 border border-border/70 px-3 py-2.5">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Current balance</p>
                <p className="text-[14px] font-semibold nums mt-0.5">{fmtUsd(total)}</p>
              </div>
              <div className="rounded-xl bg-background/55 border border-border/70 px-3 py-2.5">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Withdrawal threshold</p>
                <p className="text-[14px] font-semibold nums mt-0.5">$5,000.00</p>
              </div>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-3 max-w-[680px]">
              Add more funds to your balance to restore withdrawal access. Once the account meets the required balance level, withdrawals will become available again.
            </p>
          </div>
        )}

        {/* ---------- Chart ---------- */}
        <div className="mt-5 relative">
          <div className="h-[190px] md:h-[230px] -mx-4 md:mx-0">
            {chartData.length > 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="pf-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? '#05c168' : '#3773f5'} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={up ? '#05c168' : '#3773f5'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="x" hide />
                  <YAxis hide domain={['dataMin - 200', 'dataMax + 200']} />
                  <Tooltip
                    cursor={{ stroke: 'rgba(128,132,140,0.45)' }}
                    contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }}
                    formatter={(v: number) => [fmtUsd(v), 'Value']}
                    labelFormatter={() => ''}
                  />
                  <Area type="monotone" dataKey="v" stroke={up ? '#05c168' : '#3773f5'} strokeWidth={2.2} fill="url(#pf-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-[13.5px]">
                Portfolio chart appears as markets update
              </div>
            )}
          </div>
          <div className="flex justify-center gap-1 mt-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  'px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors',
                  range === r.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Quick actions ---------- */}
      <section className="grid grid-cols-4 gap-2.5">
        {[
          { view: 'deposit' as const, label: 'Deposit', icon: <ArrowDownToLine className="w-5 h-5" />, cls: 'text-up bg-up/12' },
          { view: 'send' as const, label: 'Send', icon: <Send className="w-5 h-5" />, cls: 'text-[#3773f5] bg-[#3773f5]/12' },
          { view: 'withdraw' as const, label: 'Withdraw', icon: <ArrowUpFromLine className="w-5 h-5" />, cls: 'text-warn bg-warn/12' },
          { view: 'receive' as const, label: 'Receive', icon: <QrCode className="w-5 h-5" />, cls: 'text-[#9945ff] bg-[#9945ff]/12' },
        ].map((a) => (
          <button
            key={a.view}
            onClick={() => navigate(a.view)}
            className="flex flex-col items-center gap-2 py-3.5 rounded-2xl bg-card border border-border hover:border-border-strong hover:bg-hover transition-all group"
          >
            <span className={cn('w-10 h-10 rounded-full flex items-center justify-center transition-transform group-hover:scale-105', a.cls)}>{a.icon}</span>
            <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">{a.label}</span>
          </button>
        ))}
      </section>

      {/* ---------- First-week trading match ---------- */}
      <section className="cp-card p-5 flex items-center justify-between gap-4 relative overflow-hidden">
        <div className="min-w-0">
          <p className="font-semibold text-[15.5px] flex items-center gap-2">
            <Gift className="w-4.5 h-4.5 text-primary" />
            {match?.status === 'LOCKED'
              ? 'Your promotional match is secured'
              : match?.status === 'RELEASED'
                ? 'Your promotional match is available'
                : match?.status === 'ACTIVE'
                  ? `Trading streak: day ${match.streakDays} of ${match.requiredDays}`
                  : match?.status === 'EXPIRED'
                    ? 'Member rewards'
                    : 'First-week trading match'}
          </p>
          <p className="text-[13.5px] text-muted-foreground mt-1 leading-relaxed">
            {match?.status === 'LOCKED'
              ? `${fmtUsd(match.bonusUsd)} was added to your promotional balance and becomes withdrawable on ${matchUnlockDate}. Your own available funds remain withdrawable.`
              : match?.status === 'RELEASED'
                ? `${fmtUsd(match.bonusUsd)} has moved into your available USD balance.`
                : match?.status === 'ACTIVE'
                  ? `Complete ${match.requiredDays} consecutive trading days at ${fmtUsd(match.targetUsd)} or more per day. Today you have traded ${fmtUsd(match.todayTotalUsd)}.`
                  : match?.status === 'EXPIRED'
                    ? 'Redeem available promotion codes from your settings.'
                    : `During your first week, trade at least ${fmtUsd(match?.minimumUsd ?? 1000)} per day for ${match?.requiredDays ?? 3} consecutive days to receive a 100% match.`}
          </p>
          {match?.status === 'ACTIVE' && <Progress value={matchProgress} className="h-1.5 mt-3 max-w-[320px]" />}
          {match?.status !== 'LOCKED' && match?.status !== 'RELEASED' && (
            <Button size="sm" className="mt-3 rounded-full h-8 px-4" onClick={() => navigate(match?.status === 'EXPIRED' ? 'settings' : 'trade')}>
              {match?.status === 'EXPIRED' ? 'View rewards' : 'Trade now'}
            </Button>
          )}
        </div>
        <div className="hidden sm:flex w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/20 items-center justify-center shrink-0">
          <ShieldCheck className="w-10 h-10 text-primary" />
        </div>
      </section>

      {/* ---------- Holdings ---------- */}
      <section>
        <SectionHeader
          title="Your assets"
          sub={`${portfolio?.holdings.length ?? 0} wallets · total ${fmtUsd(total)}`}
          action={
            <Button variant="ghost" size="sm" className="rounded-full gap-1.5 text-[13px]" onClick={() => navigate('trade')}>
              <ArrowLeftRight className="w-4 h-4" /> Trade
            </Button>
          }
        />
        {portfolio && portfolio.holdings.length > 0 ? (
          <div className="cp-card divide-y divide-border overflow-hidden">
            {portfolio.holdings.map((h) => {
              const q = quotes[h.symbol];
              const price = q?.price ?? h.price;
              const chg = q?.change24h ?? h.change24h;
              return (
                <button
                  key={h.symbol}
                  onClick={() => (h.tradeable ? navigate('asset', { symbol: h.symbol }) : navigate('trade'))}
                  className="w-full flex items-center gap-4 px-4 md:px-5 py-4 hover:bg-hover transition-colors text-left"
                >
                  <AssetIcon symbol={h.symbol} color={h.color} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[14.5px] truncate">{h.name}</p>
                    <p className="text-[13px] text-muted-foreground nums">
                      {fmtCrypto(h.total, h.symbol)}
                      {h.reserved > 0 && <span className="ml-1.5 text-[11px]">({fmtCrypto(h.available, undefined, 4)} available)</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <PriceText price={h.valueUsd} format={(n) => fmtUsd(n)} className="font-medium text-[14.5px]" />
                    <div className="flex items-center justify-end mt-0.5">
                      <PctBadge value={chg} showBg={false} className="text-[12px]" />
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cp-card">
            <EmptyState
              icon={<Wallet className="w-5 h-5" />}
              title="No balances yet"
              body="Deposit cash or crypto to start building your portfolio."
              action={<Button className="rounded-full" onClick={() => navigate('deposit')}>Deposit</Button>}
            />
          </div>
        )}
      </section>

      {/* ---------- Allocation ---------- */}
      {portfolio && portfolio.allocation.length > 1 && (
        <section>
          <SectionHeader title="Allocation" sub="Share of portfolio value" />
          <div className="cp-card p-5 space-y-4">
            {portfolio.allocation.map((a) => (
              <div key={a.symbol}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13.5px] font-medium flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />
                    {a.symbol}
                  </span>
                  <span className="text-[13px] nums text-muted-foreground">
                    {fmtUsd(a.valueUsd)} · {a.pct.toFixed(1)}%
                  </span>
                </div>
                <Progress value={a.pct} className="h-1.5" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- More you can do ---------- */}
      <section>
        <p className="micro-label mb-3">More you can do</p>
        <div className="cp-card divide-y divide-border overflow-hidden">
          {[
            { view: 'trade' as const, icon: <ArrowLeftRight className="w-5 h-5" />, label: 'Convert assets', desc: 'Swap between any listed assets' },
            { view: 'activity' as const, icon: <ChartIcon className="w-5 h-5" />, label: 'Review activity', desc: 'Every trade, transfer and ledger entry' },
            { view: 'security' as const, icon: <ShieldCheck className="w-5 h-5" />, label: 'Harden security', desc: 'Two-factor, password, device history' },
            { view: 'settings' as const, icon: <Gift className="w-5 h-5" />, label: 'Rewards & referrals', desc: 'Redeem promotion codes' },
          ].map((r) => (
            <button key={r.label} onClick={() => navigate(r.view)} className="w-full flex items-center gap-4 px-4 md:px-5 py-4 hover:bg-hover transition-colors text-left">
              <span className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground/80 shrink-0">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[14.5px]">{r.label}</p>
                <p className="text-[12.5px] text-muted-foreground truncate">{r.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
            </button>
          ))}
        </div>
      </section>

      <p className="text-[11.5px] text-muted-foreground/70 text-center pb-2">
        Market data by {provider || 'provider'} · Wallet movements are recorded in the ledger
      </p>
    </div>
  );
}

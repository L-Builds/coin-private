'use client';

// ============================================================
// Coin Private: Withdraw
// Creates a withdrawal request, funds move available → reserved
// (real hold) and settle after compliance approval.
// ============================================================
import { useState } from 'react';
import { useUI } from '@/lib/store';
import { usePortfolio, usePrices } from '@/hooks/use-cp-data';
import { AssetIcon } from '@/components/cp/primitives';
import { fmtUsd, fmtCrypto, maskAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, ChevronDown, Clock, ShieldCheck } from 'lucide-react';

type AmountMode = 'USD' | 'ASSET';

const WITHDRAWAL_FEE_RATE = 0.0005; // mirrors the current 0.05% withdrawal setting

function cleanAmountInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 8)}` : whole;
}

function amountInputValue(value: number, mode: AmountMode) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const digits = mode === 'USD' ? (value >= 1 ? 2 : 6) : 8;
  const fixed = value.toFixed(digits);
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

function addressPlaceholder(symbol: string, network?: string | null) {
  if (symbol === 'USD') return 'Bank account or withdrawal destination';
  if (symbol === 'BTC') return 'bc1q… / 1… / 3…';
  if (network === 'Ethereum') return '0x…';
  return `Paste ${network ?? symbol} address`;
}

export function WithdrawView() {
  const { navigate } = useUI();
  const { portfolio, reload } = usePortfolio();
  const { quotes } = usePrices(6000);
  const [symbol, setSymbol] = useState('BTC');
  const [amountMode, setAmountMode] = useState<AmountMode>('USD');
  const [raw, setRaw] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState<{ message: string } | null>(null);

  const chosen = portfolio?.holdings.find((h) => h.symbol === symbol);
  const effective = chosen ?? portfolio?.holdings.find((h) => h.kind === 'CRYPTO') ?? portfolio?.holdings[0];
  const activeSymbol = effective?.symbol ?? symbol;
  const holding = effective;
  const effectiveMode: AmountMode = activeSymbol === 'USD' ? 'USD' : amountMode;
  const price = activeSymbol === 'USD' ? 1 : (quotes[activeSymbol]?.price ?? holding?.price ?? 0);
  const network = quotes[activeSymbol]?.network ?? null;

  const enteredAmount = parseFloat(raw || '0') || 0;
  const amount = effectiveMode === 'USD' && activeSymbol !== 'USD'
    ? (price > 0 ? enteredAmount / price : 0)
    : enteredAmount;
  const usdAmount = activeSymbol === 'USD' ? amount : amount * price;
  const fee = amount * WITHDRAWAL_FEE_RATE;
  const feeUsd = activeSymbol === 'USD' ? fee : fee * price;
  const totalHold = amount + fee;
  const totalHoldUsd = activeSymbol === 'USD' ? totalHold : totalHold * price;
  const insufficient = holding ? totalHold > holding.available + 1e-9 : false;
  const maxAssetAmount = holding ? holding.available / (1 + WITHDRAWAL_FEE_RATE) : 0;
  const availableUsd = (holding?.available ?? 0) * price;
  const lockedMatch = activeSymbol === 'USD' && portfolio?.welcomeMatch.status === 'LOCKED'
    ? portfolio.welcomeMatch
    : null;
  const lockedUntil = lockedMatch?.unlockAt
    ? new Date(lockedMatch.unlockAt).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  function switchAmountMode(nextMode: AmountMode) {
    if (activeSymbol === 'USD' || nextMode === effectiveMode) return;
    const nextValue = nextMode === 'USD' ? amount * price : amount;
    setAmountMode(nextMode);
    setRaw(amountInputValue(nextValue, nextMode));
  }

  function setPercentage(percent: number) {
    const nextAssetAmount = maxAssetAmount * (percent / 100);
    const nextValue = effectiveMode === 'USD' ? nextAssetAmount * price : nextAssetAmount;
    setRaw(amountInputValue(nextValue, effectiveMode));
  }

  function chooseAsset(nextSymbol: string) {
    setSymbol(nextSymbol);
    setPickerOpen(false);
    setRaw('');
    setAddress('');
    setAmountMode('USD');
    setReviewing(false);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: activeSymbol, amount, address }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        setReviewing(false);
      } else {
        setDone({ message: data.message });
        reload();
      }
    } catch {
      toast.error('Network error: try again');
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  }

  const validForReview = amount > 0 && address.trim().length >= 4 && !insufficient;

  if (done) {
    return (
      <div className="max-w-[440px] mx-auto text-center py-10">
        <Clock className="w-14 h-14 mx-auto text-warn" />
        <h2 className="text-[22px] font-semibold tracking-tight mt-5">Withdrawal requested</h2>
        <p className="text-[14px] text-muted-foreground mt-2 leading-relaxed">{done.message}</p>
        <div className="grid grid-cols-2 gap-2.5 mt-8">
          <Button
            variant="secondary"
            className="h-12 rounded-xl"
            onClick={() => {
              setDone(null);
              setRaw('');
              setAddress('');
              setReviewing(false);
            }}
          >
            New withdrawal
          </Button>
          <Button className="h-12 rounded-xl" onClick={() => navigate('activity')}>View activity</Button>
        </div>
      </div>
    );
  }

  if (reviewing) {
    return (
      <div className="max-w-[600px] mx-auto">
        <button
          onClick={() => setReviewing(false)}
          className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Edit withdrawal
        </button>

        <h1 className="text-[24px] font-semibold tracking-tight">Review withdrawal</h1>
        <p className="text-[13.5px] text-muted-foreground mt-1 mb-6">Check the amount and destination before submitting the request.</p>

        <div className="cp-card overflow-hidden divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <AssetIcon symbol={activeSymbol} color={holding?.color} size={38} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[14.5px]">{holding?.name ?? activeSymbol}</p>
              <p className="text-[12px] text-muted-foreground">{activeSymbol === 'USD' ? 'Cash withdrawal' : (network ?? `${activeSymbol} network`)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-semibold nums text-[14px]">{fmtCrypto(amount, activeSymbol, 8)}</p>
              {activeSymbol !== 'USD' && <p className="text-[12px] text-muted-foreground nums">≈ {fmtUsd(usdAmount)}</p>}
            </div>
          </div>

          <div className="p-4 space-y-3 text-[13px]">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Destination</span>
              <span className="nums text-right break-all">{maskAddress(address.trim())}</span>
            </div>
            {activeSymbol !== 'USD' && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Network</span>
                <span>{network ?? activeSymbol}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Withdrawal amount</span>
              <span className="nums">{fmtCrypto(amount, activeSymbol, 8)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Withdrawal fee</span>
              <span className="nums">{fmtCrypto(fee, activeSymbol, 8)}{activeSymbol !== 'USD' ? ` · ≈ ${fmtUsd(feeUsd)}` : ''}</span>
            </div>
            <div className="flex justify-between gap-4 pt-1 font-medium">
              <span>Total held</span>
              <span className="nums text-right">{fmtCrypto(totalHold, activeSymbol, 8)}{activeSymbol !== 'USD' ? ` · ≈ ${fmtUsd(totalHoldUsd)}` : ''}</span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-secondary/50 border border-border text-[12.5px] text-muted-foreground leading-relaxed mt-4">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Submitting creates a pending withdrawal and reserves the total shown above. If the request is rejected, the hold returns to your available balance.</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <Button variant="secondary" className="h-12 rounded-xl" disabled={busy} onClick={() => setReviewing(false)}>
            Back
          </Button>
          <Button className="h-12 rounded-xl font-semibold" disabled={busy || !validForReview} onClick={submit}>
            {busy ? 'Submitting…' : 'Confirm withdrawal'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[600px] mx-auto">
      <button onClick={() => navigate('home')} className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Home
      </button>
      <h1 className="text-[24px] font-semibold tracking-tight">Withdraw</h1>
      <p className="text-[13.5px] text-muted-foreground mt-1 mb-6">Choose an asset, enter the amount in dollars or crypto, then review the destination before submitting.</p>

      <div className="space-y-4">
        {/* asset selector */}
        <section className="relative">
          <Label className="text-[12.5px] text-muted-foreground">Asset</Label>
          <button
            onClick={() => setPickerOpen(!pickerOpen)}
            className="w-full mt-1.5 flex items-center gap-3 cp-card p-4 cp-card-interactive text-left"
          >
            <AssetIcon symbol={activeSymbol} color={holding?.color} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[15px]">{holding?.name ?? activeSymbol}</p>
              <p className="text-[12px] text-muted-foreground nums mt-0.5">
                {fmtCrypto(holding?.available ?? 0, activeSymbol, 8)} available
                {activeSymbol !== 'USD' && price > 0 ? ` · ≈ ${fmtUsd(availableUsd)}` : ''}
              </p>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', pickerOpen && 'rotate-180')} />
          </button>

          {pickerOpen && (
            <div className="absolute z-20 left-0 right-0 mt-2 cp-card p-1.5 shadow-xl max-h-[280px] overflow-y-auto">
              {portfolio?.holdings.filter((h) => h.available > 0).map((h) => {
                const hPrice = h.symbol === 'USD' ? 1 : (quotes[h.symbol]?.price ?? h.price ?? 0);
                return (
                  <button
                    key={h.symbol}
                    onClick={() => chooseAsset(h.symbol)}
                    className={cn('w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-secondary text-left', activeSymbol === h.symbol && 'bg-secondary')}
                  >
                    <AssetIcon symbol={h.symbol} color={h.color} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[13.5px]">{h.name}</p>
                      <p className="text-[11.5px] text-muted-foreground nums">
                        {fmtCrypto(h.available, h.symbol, 8)}{h.symbol !== 'USD' && hPrice > 0 ? ` · ≈ ${fmtUsd(h.available * hPrice)}` : ''}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* amount */}
        <section className="cp-card p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[13px] font-medium">Amount</p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">Enter what you want to withdraw.</p>
            </div>
            {activeSymbol !== 'USD' && (
              <div className="inline-flex rounded-xl bg-secondary p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => switchAmountMode('USD')}
                  className={cn('h-8 px-3 rounded-lg text-[12px] font-medium transition-colors', effectiveMode === 'USD' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => switchAmountMode('ASSET')}
                  className={cn('h-8 px-3 rounded-lg text-[12px] font-medium transition-colors', effectiveMode === 'ASSET' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
                >
                  {activeSymbol}
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            {effectiveMode === 'USD' && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[32px] font-semibold text-muted-foreground/70">$</span>
            )}
            <input
              aria-label={`Withdrawal amount in ${effectiveMode === 'USD' ? 'USD' : activeSymbol}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={raw}
              onChange={(e) => setRaw(cleanAmountInput(e.target.value))}
              className={cn(
                'w-full bg-transparent outline-none border-0 text-[38px] md:text-[42px] leading-none font-semibold nums tracking-tight placeholder:text-muted-foreground/35',
                effectiveMode === 'USD' && 'pl-7'
              )}
            />
          </div>

          <div className="min-h-6 mt-2">
            {amount > 0 ? (
              <p className="text-[13px] text-muted-foreground nums">
                {activeSymbol === 'USD'
                  ? `${fmtCrypto(amount, 'USD', 6)}`
                  : effectiveMode === 'USD'
                    ? `≈ ${fmtCrypto(amount, activeSymbol, 8)}`
                    : `≈ ${fmtUsd(usdAmount)}`}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">Available: {fmtCrypto(holding?.available ?? 0, activeSymbol, 8)}{activeSymbol !== 'USD' && price > 0 ? ` · ≈ ${fmtUsd(availableUsd)}` : ''}</p>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            {[25, 50, 100].map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPercentage(p)}
                className="flex-1 h-9 text-[12px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors"
              >
                {p === 100 ? 'Max' : `${p}%`}
              </button>
            ))}
          </div>

          {activeSymbol !== 'USD' && !price && (
            <p className="text-warn text-[12px] mt-3">Live USD conversion is unavailable right now. Switch to {activeSymbol} to enter the crypto amount directly.</p>
          )}
          {insufficient && lockedMatch && lockedUntil ? (
            <p className="text-warn text-[12px] mt-3">
              {fmtUsd(lockedMatch.bonusUsd)} in promotional funds is locked until {lockedUntil}.
            </p>
          ) : insufficient ? (
            <p className="text-destructive text-[12px] mt-3">Amount plus the withdrawal fee exceeds your available balance.</p>
          ) : null}
        </section>

        {/* destination */}
        <section className="cp-card p-4 md:p-5">
          <Label htmlFor="dest" className="text-[13px] font-medium text-foreground">
            {activeSymbol === 'USD' ? 'Destination' : `${network ?? activeSymbol} address`}
          </Label>
          <p className="text-[11.5px] text-muted-foreground mt-0.5 mb-3">
            {activeSymbol === 'USD'
              ? 'Enter the bank account or withdrawal destination for this request.'
              : `Use an address that supports ${network ?? activeSymbol}.`}
          </p>
          <Input
            id="dest"
            className="h-12 bg-secondary/60 rounded-xl nums"
            placeholder={addressPlaceholder(activeSymbol, network)}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </section>

        {/* summary */}
        <section className="cp-card p-4 md:p-5 space-y-3 text-[12.5px]">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Withdrawal amount</span>
            <span className="nums text-right">{amount > 0 ? fmtCrypto(amount, activeSymbol, 8) : `0 ${activeSymbol}`}</span>
          </div>
          {activeSymbol !== 'USD' && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">USD value</span>
              <span className="nums text-right">{fmtUsd(usdAmount)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Withdrawal fee</span>
            <span className="nums text-right">{fmtCrypto(fee, activeSymbol, 8)}{activeSymbol !== 'USD' ? ` · ≈ ${fmtUsd(feeUsd)}` : ''}</span>
          </div>
          <div className="flex justify-between gap-4 pt-2 border-t border-border font-medium">
            <span>Total held</span>
            <span className="nums text-right">{fmtCrypto(totalHold, activeSymbol, 8)}{activeSymbol !== 'USD' ? ` · ≈ ${fmtUsd(totalHoldUsd)}` : ''}</span>
          </div>
        </section>

        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-secondary/50 border border-border text-[12.5px] text-muted-foreground leading-relaxed">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <p>While pending, the total is reserved from your available balance. If the request is rejected, the hold releases back to your wallet.</p>
        </div>
      </div>

      <Button
        className="w-full h-12 rounded-2xl text-[15px] font-semibold mt-5"
        disabled={busy || !validForReview}
        onClick={() => setReviewing(true)}
      >
        Review withdrawal
      </Button>
      <p className="text-center text-[11.5px] text-muted-foreground mt-3 flex items-center justify-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5" /> Nothing is submitted until you confirm the review
      </p>
    </div>
  );
}

'use client';

// ============================================================
// Coin Private: Admin user detail
// Identity, wallets, ledger-backed credit/debit adjustment,
// orders / transfers / security history.
// ============================================================
import { useState } from 'react';
import { useFetch } from '@/hooks/use-cp-data';
import { useUI } from '@/lib/store';
import { AssetIcon, SkeletonBlock, StatusPill, PriceText } from '@/components/cp/primitives';
import { fmtDateTime, fmtUsd, fmtCrypto } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeft, ShieldOff, ShieldCheck, BadgeCheck, ArrowDownToLine, ArrowUpFromLine, UserCog, Gift, RefreshCcw, Unlock, Pencil, ReceiptText, UserRoundPen, XCircle } from 'lucide-react';

interface DetailUser {
  id: string; email: string; name: string; role: string; status: string;
  loginId: string | null; phone: string | null; address: string | null; country: string | null;
  kycStatus: string; kycTier: number; twoFactorEnabled: boolean; createdAt: string;
  wallets: Array<{ id: string; symbol: string; address: string; available: number; reserved: number; total: number; price: number; valueUsd: number; color: string }>;
}
interface DetailData {
  user: DetailUser;
  orders: Array<{ id: string; reference: string; side: string; baseSymbol: string; amountBase: number; amountQuote: number; status: string; createdAt: string }>;
  transfers: Array<{ id: string; reference: string; kind: string; assetSymbol: string; amount: number; status: string; toAddress: string; memo: string | null; createdAt: string }>;
  deposits: Array<{ id: string; reference: string; assetSymbol: string; amount: number; method: string; status: string; note: string | null; sourceAddress: string | null; sourceReference: string | null; createdAt: string }>;
  withdrawals: Array<{ id: string; reference: string; assetSymbol: string; amount: number; status: string; address: string; note: string | null; createdAt: string }>;
  ledgerTxs: Array<{ id: string; reference: string; type: string; status: string; description: string; meta: string; createdAt: string; entries: Array<{ direction: string; assetSymbol: string; amount: number; memo?: string | null }> }>;
  securityEvents: Array<{ id: string; type: string; ip: string | null; createdAt: string }>;
  promos: Array<{ code: string; title: string; redeemedAt: string }>;
  transactionEdits: Array<{ id: string; recordType: string; recordId: string; changes: string; reason: string; editedBy: string; createdAt: string }>;
  welcomeMatch: {
    status: 'ELIGIBLE' | 'ACTIVE' | 'LOCKED' | 'RELEASED' | 'EXPIRED';
    windowEndsAt: string;
    streakDays: number;
    requiredDays: number;
    targetUsd: number;
    todayTotalUsd: number;
    bonusUsd: number;
    unlockAt: string | null;
  };
}

type EditableRecord = {
  id: string;
  kind: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'LEDGER';
  reference: string;
  status: string;
  sourceAddress?: string | null;
  sourceReference?: string | null;
  note?: string | null;
  address?: string;
  toAddress?: string;
  memo?: string | null;
  correctionNote?: string;
};

type ManagedWallet = DetailUser['wallets'][number];

type LedgerEditTarget = DetailData['ledgerTxs'][number];

function readLedgerCustomerLabel(transaction: LedgerEditTarget): string {
  try {
    const parsed = JSON.parse(transaction.meta) as { customerLabel?: string };
    if (typeof parsed.customerLabel === 'string' && parsed.customerLabel) return parsed.customerLabel;
  } catch { /* legacy metadata */ }
  return transaction.entries[0]?.direction === 'DEBIT' ? 'WALLET_DEBIT' : 'RECEIVED';
}

function canFinanciallyEditLedger(transaction: LedgerEditTarget): boolean {
  return transaction.type === 'ADJUSTMENT' && transaction.status === 'POSTED' && transaction.entries.length === 1;
}

export function AdminUserDetailView() {
  const { adminParams, adminNavigate } = useUI();
  const id = adminParams.id ?? '';
  const { data, loading, reload } = useFetch<DetailData>(`/api/admin/users/${id}`, [id]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState({ symbol: 'USD', amount: '', amountUnit: 'USD', direction: 'CREDIT', customerLabel: 'RECEIVED', reason: '' });
  const [adjustReview, setAdjustReview] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: '', email: '', loginId: '', phone: '', address: '', country: '', role: 'CUSTOMER', kycStatus: 'PENDING', kycTier: '1', password: '' });
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [record, setRecord] = useState<EditableRecord | null>(null);
  const [recordForm, setRecordForm] = useState({ sourceAddress: '', sourceReference: '', note: '', address: '', toAddress: '', memo: '', correctionNote: '', reason: '' });
  const [ledgerEdit, setLedgerEdit] = useState<LedgerEditTarget | null>(null);
  const [ledgerEditForm, setLedgerEditForm] = useState({ symbol: '', amount: '', direction: 'CREDIT', customerLabel: 'RECEIVED', reason: '' });
  const [walletToSet, setWalletToSet] = useState<ManagedWallet | null>(null);
  const [walletForm, setWalletForm] = useState({ available: '', reserved: '', fundingSource: '', reason: '' });
  const [busy, setBusy] = useState(false);

  async function submitAdjust() {
    if (!data) return;
    const wallet = data.user.wallets.find((w) => w.symbol === adjust.symbol);
    const enteredAmount = Number(adjust.amount);
    const price = adjust.symbol === 'USD' ? 1 : Number(wallet?.price ?? 0);
    const nativeAmount = adjust.symbol === 'USD' || adjust.amountUnit === 'ASSET'
      ? enteredAmount
      : price > 0 ? enteredAmount / price : 0;

    if (!(nativeAmount > 0)) {
      toast.error('Enter a valid adjustment amount');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: id, symbol: adjust.symbol, direction: adjust.direction, customerLabel: adjust.customerLabel,
          amount: nativeAmount, reason: adjust.reason,
        }),
      });
      const d = await res.json();
      if (d.error) toast.error(d.error);
      else {
        toast.success(d.message);
        setAdjustOpen(false);
        setAdjustReview(false);
        setAdjust({ symbol: 'USD', amount: '', amountUnit: 'USD', direction: 'CREDIT', customerLabel: 'RECEIVED', reason: '' });
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function patch(payload: Record<string, unknown>, msg: string) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
    const d = await res.json();
    if (d.error) toast.error(d.error);
    else {
      toast.success(msg);
      reload();
    }
  }

  function openProfile() {
    if (!data) return;
    const current = data.user;
    setProfile({
      name: current.name, email: current.email, loginId: current.loginId ?? '', phone: current.phone ?? '',
      address: current.address ?? '', country: current.country ?? '', role: current.role,
      kycStatus: current.kycStatus, kycTier: String(current.kycTier), password: '',
    });
    setProfileOpen(true);
  }

  async function saveProfile() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, name: profile.name, email: profile.email, loginId: profile.loginId || null,
          phone: profile.phone || null, address: profile.address || null, country: profile.country || null,
          role: profile.role, kycStatus: profile.kycStatus, kycTier: Number(profile.kycTier),
          ...(profile.password ? { password: profile.password } : {}),
        }),
      });
      const result = await res.json();
      if (result.error) toast.error(result.error);
      else { toast.success('Customer profile saved'); setProfileOpen(false); reload(); }
    } finally { setBusy(false); }
  }

  function openRecord(next: EditableRecord) {
    setRecord(next);
    setRecordForm({
      sourceAddress: next.sourceAddress ?? '', sourceReference: next.sourceReference ?? '', note: next.note ?? '',
      address: next.address ?? '', toAddress: next.toAddress ?? '', memo: next.memo ?? '',
      correctionNote: next.correctionNote ?? '', reason: '',
    });
  }

  async function saveRecord() {
    if (!record) return;
    setBusy(true);
    try {
      const base = { reason: recordForm.reason };
      const payload = record.kind === 'DEPOSIT'
        ? { ...base, sourceAddress: recordForm.sourceAddress || null, sourceReference: recordForm.sourceReference || null, note: recordForm.note || null }
        : record.kind === 'WITHDRAWAL'
          ? { ...base, address: recordForm.address, note: recordForm.note || null }
          : record.kind === 'TRANSFER'
            ? { ...base, toAddress: recordForm.toAddress, memo: recordForm.memo || null }
            : { ...base, correctionNote: recordForm.correctionNote };
      const res = await fetch(`/api/admin/records/${record.kind}/${record.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.error) toast.error(result.error);
      else { toast.success(result.message); setRecord(null); reload(); }
    } finally { setBusy(false); }
  }

  function openLedgerEdit(transaction: LedgerEditTarget) {
    if (!canFinanciallyEditLedger(transaction)) {
      openRecord({ id: transaction.id, kind: 'LEDGER', reference: transaction.reference, status: transaction.status });
      return;
    }
    const entry = transaction.entries[0];
    const direction = entry.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    setLedgerEdit(transaction);
    setLedgerEditForm({
      symbol: entry.assetSymbol,
      amount: String(entry.amount),
      direction,
      customerLabel: readLedgerCustomerLabel(transaction),
      reason: '',
    });
  }

  async function saveLedgerEdit() {
    if (!ledgerEdit) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/transactions/${ledgerEdit.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: ledgerEditForm.symbol,
          amount: Number(ledgerEditForm.amount),
          direction: ledgerEditForm.direction,
          customerLabel: ledgerEditForm.customerLabel,
          reason: ledgerEditForm.reason,
        }),
      });
      const result = await res.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message);
        setLedgerEdit(null);
        reload();
      }
    } finally { setBusy(false); }
  }

  async function closeAccount() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'CLOSED', closeReason }),
      });
      const result = await res.json();
      if (result.error) toast.error(result.error);
      else { toast.success('Account closed and sign-in disabled'); setCloseOpen(false); setCloseReason(''); reload(); }
    } finally { setBusy(false); }
  }

  function openWalletBalance(wallet: ManagedWallet) {
    setWalletToSet(wallet);
    setWalletForm({ available: String(wallet.available), reserved: String(wallet.reserved), fundingSource: '', reason: '' });
  }

  async function setWalletBalance() {
    if (!walletToSet) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/wallets/${walletToSet.id}/set-balance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          available: Number(walletForm.available), reserved: Number(walletForm.reserved),
          fundingSource: walletForm.fundingSource, reason: walletForm.reason,
        }),
      });
      const result = await res.json();
      if (result.error) toast.error(result.error);
      else { toast.success(result.message); setWalletToSet(null); reload(); }
    } finally { setBusy(false); }
  }

  async function manageMatch(action: 'RESET' | 'RELEASE') {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/welcome-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (d.error) toast.error(d.error);
      else {
        toast.success(action === 'RESET' ? 'Trading match eligibility reset' : 'Promotional match released');
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="h-36 w-full" />
        <SkeletonBlock className="h-52 w-full" />
      </div>
    );
  }
  if (!data) return <p className="text-muted-foreground">User not found.</p>;

  const u = data.user;
  const totalValue = u.wallets.reduce((s, w) => s + w.valueUsd, 0);
  const adjustWallet = u.wallets.find((w) => w.symbol === adjust.symbol) ?? null;
  const adjustPrice = adjust.symbol === 'USD' ? 1 : Number(adjustWallet?.price ?? 0);
  const adjustEnteredAmount = Number(adjust.amount);
  const adjustEnteredValid = Number.isFinite(adjustEnteredAmount) && adjustEnteredAmount > 0;
  const adjustNativeAmount = adjustEnteredValid
    ? (adjust.symbol === 'USD' || adjust.amountUnit === 'ASSET'
      ? adjustEnteredAmount
      : adjustPrice > 0 ? adjustEnteredAmount / adjustPrice : 0)
    : 0;
  const adjustUsdAmount = adjustEnteredValid
    ? (adjust.symbol === 'USD' || adjust.amountUnit === 'USD'
      ? adjustEnteredAmount
      : adjustEnteredAmount * adjustPrice)
    : 0;
  const adjustCurrentAvailable = Number(adjustWallet?.available ?? 0);
  const adjustCurrentUsd = adjustCurrentAvailable * adjustPrice;
  const adjustNewAvailable = adjust.direction === 'CREDIT'
    ? adjustCurrentAvailable + adjustNativeAmount
    : adjustCurrentAvailable - adjustNativeAmount;
  const adjustNewUsd = adjustNewAvailable * adjustPrice;
  const adjustPriceUnavailable = adjust.symbol !== 'USD' && adjust.amountUnit === 'USD' && !(adjustPrice > 0);
  const adjustInsufficient = adjust.direction === 'DEBIT' && adjustNativeAmount > adjustCurrentAvailable + 1e-9;
  const adjustCanReview = adjustEnteredValid
    && adjustNativeAmount > 0
    && !adjustPriceUnavailable
    && !adjustInsufficient
    && adjust.reason.trim().length >= 3;

  return (
    <div className="space-y-6">
      <button onClick={() => adminNavigate('users')} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Users
      </button>

      {/* identity header */}
      <div className="cp-card p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[20px] font-semibold tracking-tight">{u.name}</h1>
              <StatusPill status={u.status} />
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-secondary text-muted-foreground">{u.role === 'ADMIN' ? 'MANAGEMENT' : u.role}</span>
            </div>
            <p className="text-[13px] text-muted-foreground nums mt-1">{u.email}</p>
            <p className="text-[12px] text-muted-foreground mt-1">
              {u.country ?? 'Unknown country'} · {u.phone ?? 'No phone'} · KYC {u.kycStatus} (T{u.kycTier}) · 2FA {u.twoFactorEnabled ? 'on' : 'off'}
            </p>
            <p className="text-[11.5px] text-muted-foreground/70 mt-0.5">Joined {fmtDateTime(u.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px]" onClick={openProfile}>
              <UserRoundPen className="w-4 h-4" /> Edit profile
            </Button>
            {u.status === 'ACTIVE' ? (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px] text-destructive border-destructive/25 hover:bg-destructive/10" onClick={() => patch({ status: 'FROZEN' }, 'Account frozen')}>
                <ShieldOff className="w-4 h-4" /> Freeze
              </Button>
            ) : u.status === 'FROZEN' ? (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px] text-up border-up/25 hover:bg-up/10" onClick={() => patch({ status: 'ACTIVE' }, 'Account restored')}>
                <ShieldCheck className="w-4 h-4" /> Unfreeze
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px] text-up border-up/25 hover:bg-up/10" onClick={() => patch({ status: 'ACTIVE' }, 'Account reopened')}>
                <ShieldCheck className="w-4 h-4" /> Reopen
              </Button>
            )}
            {u.kycStatus !== 'VERIFIED' && (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px]" onClick={() => patch({ kycStatus: 'VERIFIED', kycTier: 2 }, 'KYC verified')}>
                <BadgeCheck className="w-4 h-4" /> Verify KYC
              </Button>
            )}
            <Button size="sm" className="rounded-full gap-1.5 text-[12.5px]" onClick={() => setAdjustOpen(true)}>
              <UserCog className="w-4 h-4" /> Adjust funds
            </Button>
            {u.status !== 'CLOSED' && (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12.5px] text-destructive border-destructive/25 hover:bg-destructive/10" onClick={() => setCloseOpen(true)}>
                <XCircle className="w-4 h-4" /> Close account
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="cp-card p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[15px] flex items-center gap-2">
              <Gift className="w-4.5 h-4.5 text-primary" /> First-week trading match
            </p>
            <p className="text-[12.5px] text-muted-foreground mt-1">
              Status {data.welcomeMatch.status} · streak {data.welcomeMatch.streakDays}/{data.welcomeMatch.requiredDays} · target {fmtUsd(data.welcomeMatch.targetUsd)}
            </p>
            <p className="text-[12px] text-muted-foreground mt-1">
              {data.welcomeMatch.status === 'LOCKED' && data.welcomeMatch.unlockAt
                ? `${fmtUsd(data.welcomeMatch.bonusUsd)} locked until ${fmtDateTime(data.welcomeMatch.unlockAt)}`
                : `Eligibility ends ${fmtDateTime(data.welcomeMatch.windowEndsAt)}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.welcomeMatch.status === 'LOCKED' && (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5" disabled={busy} onClick={() => manageMatch('RELEASE')}>
                <Unlock className="w-4 h-4" /> Release now
              </Button>
            )}
            {!['LOCKED'].includes(data.welcomeMatch.status) && (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5" disabled={busy} onClick={() => manageMatch('RESET')}>
                <RefreshCcw className="w-4 h-4" /> Reset eligibility
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* wallets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15.5px] font-semibold">Wallets · {fmtUsd(totalValue)} total</h2>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {u.wallets.map((w) => (
            <button key={w.id} type="button" className="cp-card p-4 text-left hover:border-primary/45 hover:bg-primary/[0.025] transition-colors" onClick={() => openWalletBalance(w)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <AssetIcon symbol={w.symbol} color={w.color} size={34} />
                  <div>
                    <p className="font-semibold text-[14px] nums">{w.symbol}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtUsd(w.valueUsd)}</p>
                  </div>
                </div>
                <PriceText price={w.price} className="text-[12px] text-muted-foreground" />
              </div>
              <div className="mt-3 space-y-1 text-[12.5px] nums">
                <div className="flex justify-between"><span className="text-muted-foreground">Available</span><span className="font-medium">{fmtCrypto(w.available, w.symbol, 6)}</span></div>
                {w.reserved > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Reserved</span><span className="font-medium text-warn">{fmtCrypto(w.reserved, w.symbol, 6)}</span></div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mt-2"><p className="text-[10.5px] text-muted-foreground/70 nums truncate" title={w.address}>{w.address}</p><span className="text-[10.5px] font-semibold text-primary whitespace-nowrap">Set balance</span></div>
            </button>
          ))}
        </div>
      </div>

      {/* history grid */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15.5px] font-semibold">Customer activity controls</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">Edit management-issued balance transactions here. Posted financial edits are safely reversed and reissued so the ledger stays auditable.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-[12px]" onClick={() => adminNavigate('transactions', { userId: id })}>
          <ReceiptText className="w-4 h-4" /> All ledger transactions
        </Button>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <HistoryCard title="Ledger transactions" rows={data.ledgerTxs.slice(0, 10).map((t) => ({
          key: t.id, main: customerLedgerTitle(t), sub: `${t.reference} · ${fmtDateTime(t.createdAt)}`,
          right: <div className="flex items-center gap-1.5"><StatusPill status={t.status === 'POSTED' ? 'COMPLETED' : t.status} /><Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => openLedgerEdit(t)}><Pencil className="w-3 h-3 mr-1" /> Edit</Button></div>,
        }))} />
        <HistoryCard title="Orders" rows={data.orders.slice(0, 10).map((o) => ({
          key: o.id, main: `${o.side} ${o.amountBase} ${o.baseSymbol}: ${fmtUsd(o.amountQuote)}`, sub: `${o.reference} · ${fmtDateTime(o.createdAt)}`,
          right: <StatusPill status={o.status === 'EXECUTED' ? 'COMPLETED' : o.status === 'PENDING' ? 'PENDING' : 'FAILED'} />,
        }))} />
        <HistoryCard title="Transfers" rows={data.transfers.slice(0, 8).map((t) => ({
          key: t.id, main: `${t.kind} ${t.amount} ${t.assetSymbol}`, sub: `${t.toAddress.slice(0, 14)}… · ${fmtDateTime(t.createdAt)}`,
          right: <div className="flex items-center gap-1.5"><StatusPill status={t.status === 'POSTED' ? 'COMPLETED' : t.status} />{t.status === 'PENDING' && <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => openRecord({ id: t.id, kind: 'TRANSFER', reference: t.reference, status: t.status, toAddress: t.toAddress, memo: t.memo })}><Pencil className="w-3 h-3 mr-1" /> Edit</Button>}</div>,
        }))} />
        <HistoryCard title="Deposits" rows={data.deposits.slice(0, 8).map((d) => ({
          key: d.id, main: `${d.amount} ${d.assetSymbol} · ${d.method}`, sub: `${d.reference} · ${fmtDateTime(d.createdAt)}`,
          right: <div className="flex items-center gap-1.5"><StatusPill status={d.status === 'APPROVED' ? 'COMPLETED' : d.status} /><Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => openRecord({ id: d.id, kind: 'DEPOSIT', reference: d.reference, status: d.status, sourceAddress: d.sourceAddress, sourceReference: d.sourceReference, note: d.note })}><Pencil className="w-3 h-3 mr-1" /> Details</Button></div>,
        }))} />
        <HistoryCard title="Withdrawals" rows={data.withdrawals.slice(0, 8).map((w) => ({
          key: w.id, main: `${w.amount} ${w.assetSymbol}`, sub: `${w.reference} · ${fmtDateTime(w.createdAt)}`,
          right: <div className="flex items-center gap-1.5"><StatusPill status={w.status === 'APPROVED' ? 'COMPLETED' : w.status} />{w.status === 'PENDING' && <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => openRecord({ id: w.id, kind: 'WITHDRAWAL', reference: w.reference, status: w.status, address: w.address, note: w.note })}><Pencil className="w-3 h-3 mr-1" /> Edit</Button>}</div>,
        }))} />
        <HistoryCard title="Security events" rows={data.securityEvents.slice(0, 8).map((e) => ({
          key: e.id, main: e.type.replaceAll('_', ' '), sub: `${e.ip ?? 'unknown'} · ${fmtDateTime(e.createdAt)}`,
          right: <span className={cn('w-2 h-2 rounded-full', e.type === 'LOGIN' ? 'bg-up' : e.type === 'LOGIN_FAILED' ? 'bg-destructive' : 'bg-warn')} />,
        }))} />
        <HistoryCard title="Management corrections" rows={data.transactionEdits.slice(0, 10).map((e) => ({
          key: e.id, main: `${e.recordType} · ${e.reason}`, sub: `${e.editedBy} · ${fmtDateTime(e.createdAt)}`,
          right: <Pencil className="w-3.5 h-3.5 text-muted-foreground" />,
        }))} />
      </div>

      {/* adjust dialog */}
      <Dialog open={adjustOpen} onOpenChange={(open) => { setAdjustOpen(open); if (!open) setAdjustReview(false); }}>
        <DialogContent className="max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{adjustReview ? 'Review fund adjustment' : `Adjust funds: ${u.name}`}</DialogTitle>
            <DialogDescription>
              {adjustReview
                ? 'Confirm the asset, converted amount and resulting balance before posting the audited ledger adjustment.'
                : 'Choose the asset and enter the amount in dollars or in the selected asset. Coin Private calculates the conversion before anything is posted.'}
            </DialogDescription>
          </DialogHeader>

          {!adjustReview ? (
            <div className="space-y-4 mt-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12.5px]">Direction</Label>
                  <Select value={adjust.direction} onValueChange={(v) => { setAdjustReview(false); setAdjust({ ...adjust, direction: v, customerLabel: v === 'CREDIT' ? 'RECEIVED' : 'WALLET_DEBIT' }); }}>
                    <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CREDIT">Credit (add)</SelectItem>
                      <SelectItem value="DEBIT">Debit (remove)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px]">Asset</Label>
                  <Select value={adjust.symbol} onValueChange={(v) => { setAdjustReview(false); setAdjust({ ...adjust, symbol: v, amount: '', amountUnit: 'USD' }); }}>
                    <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {u.wallets.map((w) => <SelectItem key={w.symbol} value={w.symbol}>{w.symbol}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/25 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Current available balance</p>
                    <p className="text-[14px] font-semibold nums mt-0.5">{fmtCrypto(adjustCurrentAvailable, adjust.symbol, 8)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Estimated value</p>
                    <p className="text-[13px] font-medium nums mt-0.5">{fmtUsd(adjustCurrentUsd)}</p>
                  </div>
                </div>
                {adjust.symbol !== 'USD' && (
                  <p className="text-[10.5px] text-muted-foreground mt-2">Current price used for this adjustment: 1 {adjust.symbol} ≈ {fmtUsd(adjustPrice)}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Customer activity label</Label>
                <Select value={adjust.customerLabel} onValueChange={(v) => { setAdjustReview(false); setAdjust({ ...adjust, customerLabel: v }); }}>
                  <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {adjust.direction === 'CREDIT' ? <>
                      <SelectItem value="RECEIVED">Received</SelectItem>
                      <SelectItem value="WALLET_CREDIT">Wallet credit</SelectItem>
                      <SelectItem value="BONUS_CREDIT">Bonus credit</SelectItem>
                    </> : <>
                      <SelectItem value="WALLET_DEBIT">Wallet debit</SelectItem>
                      <SelectItem value="SERVICE_FEE">Service fee</SelectItem>
                    </>}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-2xl border border-border/70 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-[12.5px]">Amount</Label>
                    <p className="text-[10.5px] text-muted-foreground mt-0.5">Enter the value in the format that is easiest for management.</p>
                  </div>
                  {adjust.symbol !== 'USD' && (
                    <div className="inline-flex rounded-xl bg-secondary/70 p-1">
                      <button type="button" onClick={() => { setAdjustReview(false); setAdjust({ ...adjust, amount: '', amountUnit: 'USD' }); }} className={cn('h-8 px-3 rounded-lg text-[11.5px] font-semibold transition-colors', adjust.amountUnit === 'USD' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>USD</button>
                      <button type="button" onClick={() => { setAdjustReview(false); setAdjust({ ...adjust, amount: '', amountUnit: 'ASSET' }); }} className={cn('h-8 px-3 rounded-lg text-[11.5px] font-semibold transition-colors', adjust.amountUnit === 'ASSET' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>{adjust.symbol}</button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  {adjust.amountUnit === 'USD' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[15px]">$</span>}
                  <Input
                    className={cn('h-12 bg-secondary/60 rounded-xl nums text-[18px] font-semibold', adjust.amountUnit === 'USD' && 'pl-7')}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={adjust.amount}
                    onChange={(e) => { setAdjustReview(false); setAdjust({ ...adjust, amount: e.target.value }); }}
                    placeholder="0.00"
                  />
                </div>

                {adjustEnteredValid && !adjustPriceUnavailable && (
                  <div className="rounded-xl bg-secondary/45 px-3 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">Converted adjustment</span>
                    <div className="text-right">
                      <p className="text-[12.5px] font-semibold nums">{fmtCrypto(adjustNativeAmount, adjust.symbol, 8)}</p>
                      <p className="text-[10.5px] text-muted-foreground nums">≈ {fmtUsd(adjustUsdAmount)}</p>
                    </div>
                  </div>
                )}

                {adjustPriceUnavailable && <p className="text-[11px] text-destructive">A USD conversion is unavailable for {adjust.symbol} because no current price is available. Enter the amount directly in {adjust.symbol} instead.</p>}
                {adjustInsufficient && <p className="text-[11px] text-destructive">This debit is larger than the customer&apos;s available {adjust.symbol} balance.</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Reason (required)</Label>
                <Input className="h-10 bg-secondary/60 rounded-xl" value={adjust.reason} onChange={(e) => { setAdjustReview(false); setAdjust({ ...adjust, reason: e.target.value }); }} placeholder="Support case #1234" />
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/20 p-3.5 space-y-2">
                <div className="flex justify-between gap-4 text-[12px]"><span className="text-muted-foreground">Action</span><span className="font-medium">{adjust.direction === 'CREDIT' ? 'Credit (add)' : 'Debit (remove)'}</span></div>
                <div className="flex justify-between gap-4 text-[12px]"><span className="text-muted-foreground">Asset</span><span className="font-medium nums">{adjust.symbol}</span></div>
                <div className="flex justify-between gap-4 text-[12px]"><span className="text-muted-foreground">Adjustment</span><span className="font-medium nums">{adjustEnteredValid && !adjustPriceUnavailable ? `${fmtCrypto(adjustNativeAmount, adjust.symbol, 8)} · ${fmtUsd(adjustUsdAmount)}` : '—'}</span></div>
                <div className="flex justify-between gap-4 text-[12px]"><span className="text-muted-foreground">Estimated new available</span><span className={cn('font-semibold nums', adjustInsufficient && 'text-destructive')}>{adjustEnteredValid && !adjustPriceUnavailable ? `${fmtCrypto(adjustNewAvailable, adjust.symbol, 8)} · ${fmtUsd(adjustNewUsd)}` : '—'}</span></div>
              </div>

              <Button className="w-full h-11 rounded-xl font-semibold" disabled={!adjustCanReview} onClick={() => setAdjustReview(true)}>
                Review {adjust.direction === 'CREDIT' ? 'credit' : 'debit'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 mt-1">
              <div className="rounded-2xl border border-border/70 overflow-hidden">
                <div className="p-4 bg-secondary/25 border-b border-border/70">
                  <p className="text-[11px] text-muted-foreground">Customer</p>
                  <p className="text-[15px] font-semibold mt-0.5">{u.name}</p>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Action</span><span className="font-medium">{adjust.direction === 'CREDIT' ? 'Credit (add)' : 'Debit (remove)'}</span></div>
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Asset</span><span className="font-medium nums">{adjust.symbol}</span></div>
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Entered</span><span className="font-medium nums">{adjust.amountUnit === 'USD' ? fmtUsd(adjustEnteredAmount) : fmtCrypto(adjustEnteredAmount, adjust.symbol, 8)}</span></div>
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Ledger amount</span><span className="font-semibold nums">{fmtCrypto(adjustNativeAmount, adjust.symbol, 8)}</span></div>
                  {adjust.symbol !== 'USD' && <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">USD value</span><span className="font-medium nums">≈ {fmtUsd(adjustUsdAmount)}</span></div>}
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Current available</span><span className="font-medium nums">{fmtCrypto(adjustCurrentAvailable, adjust.symbol, 8)}</span></div>
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">New available</span><span className="font-semibold nums">{fmtCrypto(adjustNewAvailable, adjust.symbol, 8)} · {fmtUsd(adjustNewUsd)}</span></div>
                  <div className="flex justify-between gap-4 text-[12.5px]"><span className="text-muted-foreground">Activity label</span><span className="font-medium">{adjust.customerLabel.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span></div>
                  <div className="pt-2 border-t border-border/70">
                    <p className="text-[11px] text-muted-foreground">Reason</p>
                    <p className="text-[12.5px] mt-1 break-words">{adjust.reason}</p>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">The ledger receives the converted {adjust.symbol} amount shown above. The existing audited adjustment flow is unchanged.</p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setAdjustReview(false)}>Back</Button>
                <Button className="h-10 rounded-xl font-semibold" disabled={busy || !adjustCanReview} onClick={submitAdjust}>
                  {busy ? 'Posting…' : adjust.direction === 'CREDIT' ? (
                    <><ArrowDownToLine className="w-4 h-4 mr-2" /> Confirm credit</>
                  ) : (
                    <><ArrowUpFromLine className="w-4 h-4 mr-2" /> Confirm debit</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={walletToSet !== null} onOpenChange={(open) => { if (!open) setWalletToSet(null); }}>
        <DialogContent className="max-w-[440px]">
          {walletToSet && <>
            <DialogHeader>
              <DialogTitle>Set {walletToSet.symbol} wallet balance</DialogTitle>
              <DialogDescription>Enter the exact amount you want this customer wallet to show. The difference updates immediately and is recorded in the customer&apos;s activity.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3.5 mt-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-[12.5px]">Available {walletToSet.symbol}</Label><Input className="h-10 bg-secondary/60 rounded-xl nums" type="number" min="0" step="any" value={walletForm.available} onChange={(e) => setWalletForm({ ...walletForm, available: e.target.value })} /></div>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Reserved {walletToSet.symbol}</Label><Input className="h-10 bg-secondary/60 rounded-xl nums" type="number" min="0" step="any" value={walletForm.reserved} onChange={(e) => setWalletForm({ ...walletForm, reserved: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">Credited by / source shown to customer</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={walletForm.fundingSource} onChange={(e) => setWalletForm({ ...walletForm, fundingSource: e.target.value })} placeholder="e.g. Funding account or source address" /><p className="text-[11px] text-muted-foreground">This is shown as a Management-recorded source in the customer activity.</p></div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">Reason (required)</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[76px]" value={walletForm.reason} onChange={(e) => setWalletForm({ ...walletForm, reason: e.target.value })} placeholder="Reason for setting this wallet balance" /></div>
              <Button className="w-full h-10 rounded-xl font-semibold" disabled={busy || !Number.isFinite(Number(walletForm.available)) || !Number.isFinite(Number(walletForm.reserved)) || Number(walletForm.available) < 0 || Number(walletForm.reserved) < 0 || walletForm.reason.trim().length < 3} onClick={setWalletBalance}>{busy ? 'Updating…' : `Set ${walletToSet.symbol} balance`}</Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-[560px] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit customer profile</DialogTitle>
            <DialogDescription>Changes are logged. A temporary password immediately replaces the customer password when supplied.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 mt-1">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-[12.5px]">Full name</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">Login ID</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={profile.loginId} onChange={(e) => setProfile({ ...profile, loginId: e.target.value })} placeholder="Optional" /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-[12.5px]">Email</Label><Input className="h-10 bg-secondary/60 rounded-xl" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-[12.5px]">Phone</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">Country</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-[12.5px]">Address</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></div>
            <div className="space-y-1.5"><Label className="text-[12.5px]">New temporary password</Label><Input className="h-10 bg-secondary/60 rounded-xl" type="password" value={profile.password} onChange={(e) => setProfile({ ...profile, password: e.target.value })} placeholder="Leave blank to keep the current password" /><p className="text-[11px] text-muted-foreground">At least 8 characters if changed.</p></div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label className="text-[12.5px]">Role</Label><Select value={profile.role} onValueChange={(v) => setProfile({ ...profile, role: v })}><SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CUSTOMER">Customer</SelectItem><SelectItem value="ADMIN">Management</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">KYC status</Label><Select value={profile.kycStatus} onValueChange={(v) => setProfile({ ...profile, kycStatus: v })}><SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="VERIFIED">Verified</SelectItem><SelectItem value="UNVERIFIED">Unverified</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="text-[12.5px]">KYC tier</Label><Select value={profile.kycTier} onValueChange={(v) => setProfile({ ...profile, kycTier: v })}><SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Tier 1</SelectItem><SelectItem value="2">Tier 2</SelectItem><SelectItem value="3">Tier 3</SelectItem></SelectContent></Select></div>
            </div>
            <Button className="w-full h-10 rounded-xl font-semibold" disabled={busy || profile.name.trim().length < 2 || !profile.email || (profile.password.length > 0 && profile.password.length < 8)} onClick={saveProfile}>{busy ? 'Saving…' : 'Save profile'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ledgerEdit !== null} onOpenChange={(open) => { if (!open) setLedgerEdit(null); }}>
        <DialogContent className="max-w-[460px]">
          {ledgerEdit && <>
            <DialogHeader>
              <DialogTitle>Edit transaction {ledgerEdit.reference}</DialogTitle>
              <DialogDescription>
                Change the asset, amount or direction without manually undoing anything first. Saving performs one atomic correction: the original is reversed and the corrected transaction is reissued.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3.5 mt-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12.5px]">Direction</Label>
                  <Select value={ledgerEditForm.direction} onValueChange={(v) => setLedgerEditForm({
                    ...ledgerEditForm,
                    direction: v,
                    customerLabel: v === 'CREDIT' ? 'RECEIVED' : 'WALLET_DEBIT',
                  })}>
                    <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CREDIT">Credit (add)</SelectItem>
                      <SelectItem value="DEBIT">Debit (remove)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px]">Asset</Label>
                  <Select value={ledgerEditForm.symbol} onValueChange={(v) => setLedgerEditForm({ ...ledgerEditForm, symbol: v })}>
                    <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {u.wallets.map((w) => <SelectItem key={w.symbol} value={w.symbol}>{w.symbol}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Customer activity label</Label>
                <Select value={ledgerEditForm.customerLabel} onValueChange={(v) => setLedgerEditForm({ ...ledgerEditForm, customerLabel: v })}>
                  <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ledgerEditForm.direction === 'CREDIT' ? <>
                      <SelectItem value="RECEIVED">Received</SelectItem>
                      <SelectItem value="WALLET_CREDIT">Wallet credit</SelectItem>
                      <SelectItem value="BONUS_CREDIT">Bonus credit</SelectItem>
                    </> : <>
                      <SelectItem value="WALLET_DEBIT">Wallet debit</SelectItem>
                      <SelectItem value="SERVICE_FEE">Service fee</SelectItem>
                    </>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Amount</Label>
                <Input className="h-10 bg-secondary/60 rounded-xl nums" type="number" min="0" step="any" value={ledgerEditForm.amount} onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Reason for correction (required, audited)</Label>
                <Textarea className="bg-secondary/60 rounded-xl min-h-[78px]" value={ledgerEditForm.reason} onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, reason: e.target.value })} placeholder="Example: credited USD by mistake; should have been BTC" />
              </div>
              <p className="text-[11px] text-muted-foreground">The original transaction remains visible as REVERSED and the corrected replacement is added automatically. Balances and audit history stay consistent.</p>
              <Button className="w-full h-10 rounded-xl font-semibold" disabled={busy || !(Number(ledgerEditForm.amount) > 0) || ledgerEditForm.reason.trim().length < 3} onClick={saveLedgerEdit}>
                {busy ? 'Correcting…' : 'Save transaction changes'}
              </Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={record !== null} onOpenChange={(open) => { if (!open) setRecord(null); }}>
        <DialogContent className="max-w-[480px]">
          {record && <>
            <DialogHeader>
              <DialogTitle>{record.kind === 'LEDGER' ? 'Edit transaction note' : `Edit ${record.kind.toLowerCase()} details`}</DialogTitle>
              <DialogDescription>{record.reference} · system-generated financial values remain tied to their source workflow; this editor safely corrects the transaction note without rewriting ledger balances.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3.5 mt-1">
              {record.kind === 'DEPOSIT' && <>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Reported source address</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={recordForm.sourceAddress} onChange={(e) => setRecordForm({ ...recordForm, sourceAddress: e.target.value })} placeholder="BTC/crypto source address or bank origin" /></div>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Reported source reference</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={recordForm.sourceReference} onChange={(e) => setRecordForm({ ...recordForm, sourceReference: e.target.value })} placeholder="Bank or network reference" /></div>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Operational note</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[72px]" value={recordForm.note} onChange={(e) => setRecordForm({ ...recordForm, note: e.target.value })} /></div>
              </>}
              {record.kind === 'WITHDRAWAL' && <>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Destination address</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={recordForm.address} onChange={(e) => setRecordForm({ ...recordForm, address: e.target.value })} /></div>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Operational note</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[72px]" value={recordForm.note} onChange={(e) => setRecordForm({ ...recordForm, note: e.target.value })} /></div>
              </>}
              {record.kind === 'TRANSFER' && <>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Destination address</Label><Input className="h-10 bg-secondary/60 rounded-xl" value={recordForm.toAddress} onChange={(e) => setRecordForm({ ...recordForm, toAddress: e.target.value })} /></div>
                <div className="space-y-1.5"><Label className="text-[12.5px]">Memo</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[72px]" value={recordForm.memo} onChange={(e) => setRecordForm({ ...recordForm, memo: e.target.value })} /></div>
              </>}
              {record.kind === 'LEDGER' && <div className="space-y-1.5"><Label className="text-[12.5px]">Correction note</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[80px]" value={recordForm.correctionNote} onChange={(e) => setRecordForm({ ...recordForm, correctionNote: e.target.value })} placeholder="What operational detail needs correcting?" /></div>}
              <div className="space-y-1.5"><Label className="text-[12.5px]">Reason (required, audited)</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[72px]" value={recordForm.reason} onChange={(e) => setRecordForm({ ...recordForm, reason: e.target.value })} /></div>
              <Button className="w-full h-10 rounded-xl font-semibold" disabled={busy || recordForm.reason.trim().length < 3 || (record.kind === 'LEDGER' && recordForm.correctionNote.trim().length < 3)} onClick={saveRecord}>{busy ? 'Saving…' : 'Save audited correction'}</Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>Close {u.name}&apos;s account?</DialogTitle><DialogDescription>This disables sign-in and preserves financial history, corrections and audit records. It does not erase transactions.</DialogDescription></DialogHeader>
          <div className="space-y-3.5 mt-1"><div className="space-y-1.5"><Label className="text-[12.5px]">Closure reason (required)</Label><Textarea className="bg-secondary/60 rounded-xl min-h-[80px]" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} /></div><Button variant="destructive" className="w-full h-10 rounded-xl" disabled={busy || closeReason.trim().length < 3} onClick={closeAccount}>{busy ? 'Closing…' : 'Close account'}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function customerLedgerTitle(transaction: DetailData['ledgerTxs'][number]): string {
  const symbol = transaction.entries[0]?.assetSymbol ?? '';
  let label = '';
  try {
    const meta = JSON.parse(transaction.meta) as { customerLabel?: string };
    label = meta.customerLabel ?? '';
  } catch { /* legacy transaction metadata */ }
  if (!label && transaction.type === 'ADJUSTMENT') {
    label = transaction.entries.some((entry) => entry.direction === 'CREDIT') ? 'RECEIVED' : 'WALLET_DEBIT';
  }
  const words: Record<string, string> = {
    RECEIVED: 'Received', WALLET_CREDIT: 'Wallet credit', BONUS_CREDIT: 'Bonus credit',
    WALLET_DEBIT: 'Wallet debit', SERVICE_FEE: 'Service fee',
  };
  return words[label] ? `${words[label]}${symbol ? ` ${symbol}` : ''}` : transaction.description;
}

function HistoryCard({ title, rows }: { title: string; rows: Array<{ key: string; main: string; sub: string; right: React.ReactNode }> }) {
  return (
    <div className="cp-card p-4">
      <h3 className="text-[13.5px] font-semibold mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-4 text-center">Nothing yet.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium truncate">{r.main}</p>
                <p className="text-[10.5px] text-muted-foreground nums truncate">{r.sub}</p>
              </div>
              {r.right}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

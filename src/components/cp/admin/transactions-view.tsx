'use client';

// ============================================================
// Coin Private: Admin transactions (global ledger)
// Filter, inspect entries, reverse posted transactions
// atomically with mirrored entries.
// ============================================================
import { useState } from 'react';
import { useFetch } from '@/hooks/use-cp-data';
import { useUI } from '@/lib/store';
import { SkeletonBlock, StatusPill, EmptyState } from '@/components/cp/primitives';
import { fmtDateTime, fmtCrypto } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Search, Undo2, Eye, Pencil, ArrowLeft } from 'lucide-react';

interface LedgerTxRow {
  id: string; reference: string; type: string; status: string;
  description: string; userId?: string | null; userName?: string; userEmail?: string;
  walletSymbols: string[];
  entries: Array<{ id: string; direction: string; assetSymbol: string; amount: number; balanceBefore: number; balanceAfter: number; memo: string | null }>;
  createdAt: string; meta: string;
}

const TYPES = ['ALL', 'BUY', 'SELL', 'CONVERT', 'DEPOSIT', 'WITHDRAWAL', 'SEND', 'BONUS', 'ADJUSTMENT', 'REVERSAL'];

function ledgerCustomerLabel(transaction: LedgerTxRow): string {
  try {
    const parsed = JSON.parse(transaction.meta) as { customerLabel?: string };
    if (typeof parsed.customerLabel === 'string' && parsed.customerLabel) return parsed.customerLabel;
  } catch { /* legacy metadata */ }
  return transaction.entries[0]?.direction === 'DEBIT' ? 'WALLET_DEBIT' : 'RECEIVED';
}

function canFinanciallyEdit(transaction: LedgerTxRow | null): boolean {
  return Boolean(
    transaction
    && transaction.type === 'ADJUSTMENT'
    && transaction.status === 'POSTED'
    && transaction.userId
    && transaction.entries.length === 1
  );
}

export function AdminTransactionsView() {
  const { adminParams, adminNavigate } = useUI();
  const userId = adminParams.userId ?? '';
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useFetch<{ transactions: LedgerTxRow[] }>(
    `/api/admin/transactions?type=${type === 'ALL' ? '' : type}&status=${status === 'ALL' ? '' : status}&q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`,
    [type, status, q, userId]
  );
  const [selected, setSelected] = useState<LedgerTxRow | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [editForm, setEditForm] = useState({ symbol: '', amount: '', direction: 'CREDIT', customerLabel: 'RECEIVED' });
  const [busy, setBusy] = useState(false);

  async function submitReverse() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/transactions/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledgerTxId: selected.id, reason }),
      });
      const d = await res.json();
      if (d.error) toast.error(d.error);
      else {
        toast.success(d.message);
        setReverseOpen(false);
        setReason('');
        setSelected(null);
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  function openCorrection(transaction: LedgerTxRow) {
    setSelected(transaction);
    setCorrectionReason('');
    setCorrectionNote('');
    if (canFinanciallyEdit(transaction)) {
      const entry = transaction.entries[0];
      const direction = entry.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
      setEditForm({
        symbol: entry.assetSymbol,
        amount: String(entry.amount),
        direction,
        customerLabel: ledgerCustomerLabel(transaction),
      });
    }
    setCorrectionOpen(true);
  }

  async function submitCorrection() {
    if (!selected) return;
    setBusy(true);
    try {
      const financial = canFinanciallyEdit(selected);
      const res = financial
        ? await fetch(`/api/admin/transactions/${selected.id}/edit`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol: editForm.symbol,
              amount: Number(editForm.amount),
              direction: editForm.direction,
              customerLabel: editForm.customerLabel,
              reason: correctionReason,
            }),
          })
        : await fetch(`/api/admin/records/LEDGER/${selected.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correctionNote, reason: correctionReason }),
          });
      const d = await res.json();
      if (d.error) toast.error(d.error);
      else {
        toast.success(d.message);
        setCorrectionOpen(false);
        setCorrectionNote('');
        setCorrectionReason('');
        setSelected(null);
        reload();
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Transactions</h1>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Every ledger transaction with its balanced entries. Reversals post mirrored entries: balances are never edited in place.
        </p>
      </div>

      {userId && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-[12.5px]">
          <span>Showing only this customer&apos;s ledger transactions.</span>
          <Button variant="ghost" size="sm" className="h-7 rounded-lg gap-1 text-[12px]" onClick={() => adminNavigate('user-detail', { id: userId })}><ArrowLeft className="w-3.5 h-3.5" /> Customer profile</Button>
        </div>
      )}

      {/* filters */}
      <div className="flex flex-col md:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="h-10 pl-9.5 rounded-full bg-secondary/60" placeholder="Search reference or description" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2.5">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[150px] h-10 rounded-full bg-secondary/60"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'ALL' ? 'All types' : t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px] h-10 rounded-full bg-secondary/60"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="POSTED">Posted</SelectItem>
              <SelectItem value="REVERSED">Reversed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* table */}
      {loading && !data ? (
        <div className="cp-card p-4 space-y-3">{[1, 2, 3, 4, 5].map((i) => <SkeletonBlock key={i} className="h-11" />)}</div>
      ) : !data?.transactions.length ? (
        <div className="cp-card"><EmptyState icon={<Search className="w-5 h-5" />} title="No transactions match" body="Adjust the filters to widen the search." /></div>
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[820px]">
              <thead>
                <tr className="text-left text-muted-foreground text-[11px] uppercase tracking-wide border-b border-border">
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Description</th>
                  <th className="px-3 py-3 font-medium">User</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-hover transition-colors">
                    <td className="px-5 py-3 nums text-[12px]">{t.reference}</td>
                    <td className="px-3 py-3">
                      <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-secondary text-muted-foreground">{t.type}</span>
                    </td>
                    <td className="px-3 py-3 max-w-[240px]"><p className="truncate">{t.description}</p></td>
                    <td className="px-3 py-3 text-[12px] text-muted-foreground">{t.userEmail ?? '-'}</td>
                    <td className="px-3 py-3"><StatusPill status={t.status === 'POSTED' ? 'COMPLETED' : t.status} /></td>
                    <td className="px-3 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{fmtDateTime(t.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-8 rounded-lg gap-1.5 text-[12px]" onClick={() => setSelected(t)}>
                          <Eye className="w-3.5 h-3.5" /> Entries
                        </Button>
                        {t.status === 'POSTED' && t.type !== 'REVERSAL' && (
                          <Button variant="ghost" size="sm" className="h-8 rounded-lg gap-1.5 text-[12px] text-destructive hover:text-destructive" onClick={() => { setSelected(t); setReverseOpen(true); }}>
                            <Undo2 className="w-3.5 h-3.5" /> Reverse
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-8 rounded-lg gap-1.5 text-[12px]" onClick={() => openCorrection(t)}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* entries dialog */}
      <Dialog open={selected !== null && !reverseOpen && !correctionOpen} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-[480px]">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 flex-wrap">
                  {selected.reference} <StatusPill status={selected.status === 'POSTED' ? 'COMPLETED' : selected.status} />
                </DialogTitle>
                <DialogDescription>{selected.description} · {selected.userEmail ?? 'system'}</DialogDescription>
              </DialogHeader>
              <div className="cp-card divide-y divide-border overflow-hidden mt-1">
                {selected.entries.map((e) => (
                  <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className={cn('text-[13px] font-semibold nums', e.direction === 'DEBIT' ? 'text-destructive' : 'text-up')}>
                        {e.direction === 'DEBIT' ? '−' : '+'} {fmtCrypto(e.amount, e.assetSymbol, 8)}
                      </p>
                      {e.memo && <p className="text-[11px] text-muted-foreground">{e.memo}</p>}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground nums text-right whitespace-nowrap">
                      {fmtCrypto(e.balanceBefore, e.assetSymbol, 4)} → {fmtCrypto(e.balanceAfter, e.assetSymbol, 4)}
                    </p>
                  </div>
                ))}
              </div>
              {ledgerCorrections(selected.meta).map((c, index) => <p key={`${c.at}-${index}`} className="text-[11px] rounded-lg bg-primary/5 border border-primary/15 p-2.5 mt-2"><span className="font-semibold">Correction note:</span> {c.note} <span className="text-muted-foreground">({c.at})</span></p>)}
              <p className="text-[11px] text-muted-foreground mt-2">Wallet updates and ledger entries are committed in one transaction.</p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* reverse dialog */}
      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reverse {selected?.reference}</DialogTitle>
            <DialogDescription>
              A mirrored REVERSAL transaction will restore all affected balances atomically. The original stays visible with a REVERSED status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Reason (required, audited)</Label>
              <Textarea className="bg-secondary/60 rounded-xl min-h-[80px]" placeholder="Why is this transaction being reversed?" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button className="w-full h-10 rounded-xl font-semibold" disabled={busy || reason.trim().length < 3} onClick={submitReverse}>
              {busy ? 'Reversing…' : 'Post reversal'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{canFinanciallyEdit(selected) ? `Edit ${selected.reference}` : `Edit note for ${selected?.reference ?? 'transaction'}`}</DialogTitle>
            <DialogDescription>
              {canFinanciallyEdit(selected)
                ? 'Change the asset, amount or direction directly. Saving reverses the original and reissues the corrected adjustment in one atomic operation.'
                : 'This transaction was created by another platform workflow, so financial values stay tied to that source record. You can still attach an audited correction note.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {canFinanciallyEdit(selected) ? <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12.5px]">Direction</Label>
                  <Select value={editForm.direction} onValueChange={(v) => setEditForm({
                    ...editForm,
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
                  <Select value={editForm.symbol} onValueChange={(v) => setEditForm({ ...editForm, symbol: v })}>
                    <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {selected.walletSymbols.map((symbol) => <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Customer activity label</Label>
                <Select value={editForm.customerLabel} onValueChange={(v) => setEditForm({ ...editForm, customerLabel: v })}>
                  <SelectTrigger className="h-10 rounded-xl bg-secondary/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {editForm.direction === 'CREDIT' ? <>
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
                <Input className="h-10 bg-secondary/60 rounded-xl nums" type="number" min="0" step="any" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
              </div>
            </> : (
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Correction note</Label>
                <Textarea className="bg-secondary/60 rounded-xl min-h-[80px]" value={correctionNote} onChange={(e) => setCorrectionNote(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Reason (required, audited)</Label>
              <Textarea className="bg-secondary/60 rounded-xl min-h-[80px]" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} placeholder={canFinanciallyEdit(selected) ? 'Example: credited USD by mistake; should have been BTC' : 'Why is this correction needed?'} />
            </div>
            {canFinanciallyEdit(selected) && <p className="text-[11px] text-muted-foreground">The original remains visible as REVERSED. The corrected replacement is posted automatically, so balances and audit history remain consistent.</p>}
            <Button
              className="w-full h-10 rounded-xl font-semibold"
              disabled={busy || correctionReason.trim().length < 3 || (canFinanciallyEdit(selected) ? !(Number(editForm.amount) > 0) : correctionNote.trim().length < 3)}
              onClick={submitCorrection}
            >
              {busy ? 'Saving…' : canFinanciallyEdit(selected) ? 'Save transaction changes' : 'Save correction note'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ledgerCorrections(meta: string): Array<{ note: string; at: string }> {
  try {
    const parsed = JSON.parse(meta) as { corrections?: Array<{ note?: string; at?: string }> };
    return Array.isArray(parsed.corrections)
      ? parsed.corrections.filter((item): item is { note: string; at: string } => typeof item?.note === 'string' && typeof item?.at === 'string')
      : [];
  } catch { return []; }
}

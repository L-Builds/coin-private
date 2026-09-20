'use client';

// ============================================================
// Coin Private: Admin approvals queue
// Deposits / withdrawals / risk-held trades. Approve settles
// through the ledger; reject releases holds. Real outcomes.
// ============================================================
import { useState } from 'react';
import { useFetch } from '@/hooks/use-cp-data';
import { SkeletonBlock, StatusPill, EmptyState, SegmentedTabs } from '@/components/cp/primitives';
import { fmtDateTime, fmtUsd, fmtCrypto, maskAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ClipboardCheck, ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Check, X, BellRing, CalendarClock } from 'lucide-react';

interface ApprovalRow {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'RISK_TRADE';
  reference: string;
  status: string;
  amount: number;
  assetSymbol: string | null;
  userName?: string;
  userEmail?: string;
  payload: Record<string, unknown>;
  decidedBy?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  DEPOSIT: { label: 'Deposit', icon: <ArrowDownToLine className="w-4.5 h-4.5" />, cls: 'bg-up/12 text-up' },
  WITHDRAWAL: { label: 'Withdrawal', icon: <ArrowUpFromLine className="w-4.5 h-4.5" />, cls: 'bg-warn/12 text-warn' },
  RISK_TRADE: { label: 'Risk trade', icon: <ShieldAlert className="w-4.5 h-4.5" />, cls: 'bg-[#9945ff]/12 text-[#9945ff]' },
};

export function AdminApprovalsView() {
  const [tab, setTab] = useState('PENDING');
  const { data, loading, reload } = useFetch<{ approvals: ApprovalRow[] }>(`/api/admin/approvals?status=${tab}`, [tab]);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<ApprovalRow | null>(null);
  const [processingDate, setProcessingDate] = useState('');

  async function decide(a: ApprovalRow, decision: 'APPROVED' | 'REJECTED', completionDate?: string) {
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/admin/approvals/${a.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note || undefined, processingDate: completionDate || undefined }),
      });
      const d = await res.json();
      if (d.error) toast.error(d.error);
      else {
        toast.success(`${a.type} ${decision.toLowerCase()}: ${a.reference}`);
        setNote('');
        reload();
        return true;
      }
      return false;
    } catch {
      toast.error('Could not update this approval');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function sendWithdrawalNotice(a: ApprovalRow) {
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/admin/approvals/${a.id}/withdrawal-notice`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok || d.error) toast.error(d.error ?? 'Could not send withdrawal notice');
      else toast.success(`Withdrawal notice sent to ${a.userName ?? 'customer'}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Approvals</h1>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Approving a deposit credits the ledger. Approving a withdrawal starts its management-dated processing period. Rejecting returns held funds instantly.
        </p>
      </div>

      <SegmentedTabs
        items={[
          { value: 'PENDING', label: 'Pending' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'REJECTED', label: 'Rejected' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading && !data ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-28" />)}</div>
      ) : !data?.approvals.length ? (
        <div className="cp-card">
          <EmptyState
            icon={<ClipboardCheck className="w-5 h-5" />}
            title={tab === 'PENDING' ? 'Queue is clear' : `No ${tab.toLowerCase()} items`}
            body={tab === 'PENDING' ? 'New deposit requests, withdrawals and large trades will appear here for review.' : undefined}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {data.approvals.map((a) => {
            const meta = TYPE_META[a.type];
            const p = a.payload as {
              depositId?: string; method?: string; withdrawalId?: string; fee?: number; holdAmount?: number; address?: string; processingUntil?: string;
              orderId?: string; side?: string; base?: string; source?: string; amountBase?: number; amountQuote?: number; price?: number;
            };
            return (
              <div key={a.id} className={cn('cp-card p-4 md:p-5', a.status === 'PENDING' && a.type === 'RISK_TRADE' && 'border-[#9945ff]/25')}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <span className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', meta.cls)}>{meta.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <p className="font-semibold text-[14.5px]">{meta.label} · {a.userName ?? 'Unknown'}</p>
                        <StatusPill status={a.status} />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground nums mt-1">
                        {a.userEmail} · {a.reference} · {fmtDateTime(a.createdAt)}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed">
                        {a.type === 'DEPOSIT' && <>Crypto deposit of <span className="nums font-medium text-foreground">{fmtCrypto(a.amount, a.assetSymbol ?? '', 6)}</span> requesting credit{p.method ? ` via ${p.method.toLowerCase()}` : ''}.</>}
                        {a.type === 'WITHDRAWAL' && <>Send <span className="nums font-medium text-foreground">{fmtCrypto(a.amount, a.assetSymbol ?? '', 6)}</span> to <span className="nums">{maskAddress(p.address ?? '')}</span>{p.holdAmount ? `: hold ${fmtCrypto(p.holdAmount, a.assetSymbol ?? '', 6)}` : ''}.</>}
                        {a.type === 'RISK_TRADE' && <>{p.side} <span className="nums font-medium text-foreground">{p.side === 'CONVERT' ? `${p.amountBase} ${p.base}` : `${fmtUsd(p.amountQuote ?? a.amount)}`}</span> above review threshold{p.price ? ` @ ${fmtUsd(p.price)}` : ''}.</>}
                      </p>
                      {a.type === 'WITHDRAWAL' && a.status === 'APPROVED' && p.processingUntil && (
                        <p className="text-[12px] text-muted-foreground mt-1.5">
                          Processing through {new Date(p.processingUntil).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}
                      {a.decisionNote && <p className="text-[12px] text-muted-foreground mt-1.5 italic">“{a.decisionNote}”: {a.decidedBy}</p>}
                    </div>
                  </div>

                  {a.status === 'PENDING' && (
                    <div className="flex md:flex-col gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="rounded-full gap-1.5 h-9 px-4"
                        disabled={busyId === a.id}
                        onClick={() => {
                          if (a.type === 'WITHDRAWAL') {
                            setApproveTarget(a);
                            setProcessingDate('');
                          } else {
                            void decide(a, 'APPROVED');
                          }
                        }}
                      >
                        <Check className="w-4 h-4" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-full gap-1.5 h-9 px-4 text-destructive border-destructive/25 hover:bg-destructive/10 hover:text-destructive" disabled={busyId === a.id} onClick={() => decide(a, 'REJECTED')}>
                        <X className="w-4 h-4" /> Reject
                      </Button>
                    </div>
                  )}
                  {a.status === 'REJECTED' && a.type === 'WITHDRAWAL' && (
                    <div className="shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full gap-1.5 h-9 px-4"
                        disabled={busyId === a.id}
                        onClick={() => sendWithdrawalNotice(a)}
                      >
                        <BellRing className="w-4 h-4" /> Send withdrawal notice
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* note attached to next decision */}
      <div className="cp-card p-4">
        <p className="micro-label mb-2">Decision note (optional, attached to your next decision)</p>
        <Textarea className="bg-secondary/60 rounded-xl min-h-[64px]" placeholder="e.g. KYC documents verified; source of funds confirmed" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <Dialog
        open={Boolean(approveTarget)}
        onOpenChange={(open) => {
          if (!open && busyId !== approveTarget?.id) {
            setApproveTarget(null);
            setProcessingDate('');
          }
        }}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Approve withdrawal</DialogTitle>
            <DialogDescription>
              Choose the date management expects this withdrawal to finish processing. The customer will see this date while the withdrawal remains in processing.
            </DialogDescription>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/35 px-3.5 py-3">
                <p className="text-[12px] text-muted-foreground">{approveTarget.userName ?? 'Customer'} · {approveTarget.reference}</p>
                <p className="text-[15px] font-semibold nums mt-1">{fmtCrypto(approveTarget.amount, approveTarget.assetSymbol ?? '', 6)}</p>
              </div>
              <div>
                <label htmlFor="withdrawal-processing-date" className="text-[12.5px] font-medium">Processing completion date</label>
                <div className="relative mt-1.5">
                  <CalendarClock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    id="withdrawal-processing-date"
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={processingDate}
                    onChange={(e) => setProcessingDate(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <p className="text-[11.5px] text-muted-foreground mt-1.5">The customer notice will show the selected date at 11:59 PM.</p>
              </div>
              <Button
                className="w-full rounded-xl"
                disabled={!processingDate || busyId === approveTarget.id}
                onClick={async () => {
                  if (!approveTarget) return;
                  const target = approveTarget;
                  const success = await decide(target, 'APPROVED', processingDate);
                  if (success) {
                    setApproveTarget(null);
                    setProcessingDate('');
                  }
                }}
              >
                {busyId === approveTarget.id ? 'Approving…' : 'Confirm approval'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, handler, ok, readJson } from '@/lib/api';
import { settleMaturedWithdrawals } from '@/lib/withdrawal-processing';

// GET /api/activity: unified activity feed for the signed-in user.
// Merges orders, transfers, deposits, withdrawals and ledger entries.
// Customer-hidden items are omitted without deleting the underlying records.
export const GET = handler(async (req: NextRequest) => {
  const user = await requireAuth(req);
  await settleMaturedWithdrawals(user.id);
  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') ?? 'all';

  const hidden = await db.customerHiddenItem.findMany({
    where: { userId: user.id, area: 'ACTIVITY' },
    select: { itemId: true },
  });
  const hiddenIds = hidden.map((item) => item.itemId);
  const rawHidden = (prefix: string) => hiddenIds.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));

  const hiddenOrders = rawHidden('ord-');
  const hiddenTransfers = rawHidden('trf-');
  const hiddenDeposits = rawHidden('dep-');
  const hiddenWithdrawals = rawHidden('wdr-');
  const hiddenLedger = rawHidden('ldg-');

  const [orders, transfers, deposits, withdrawals, ledgerTxs] = await Promise.all([
    filter === 'all' || filter === 'trades'
      ? db.order.findMany({ where: { userId: user.id, ...(hiddenOrders.length ? { id: { notIn: hiddenOrders } } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 })
      : Promise.resolve([]),
    filter === 'all' || filter === 'transfers'
      ? db.transfer.findMany({ where: { userId: user.id, ...(hiddenTransfers.length ? { id: { notIn: hiddenTransfers } } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 })
      : Promise.resolve([]),
    filter === 'all' || filter === 'deposits'
      ? db.depositRequest.findMany({ where: { userId: user.id, ...(hiddenDeposits.length ? { id: { notIn: hiddenDeposits } } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 })
      : Promise.resolve([]),
    filter === 'all' || filter === 'withdrawals'
      ? db.withdrawalRequest.findMany({ where: { userId: user.id, ...(hiddenWithdrawals.length ? { id: { notIn: hiddenWithdrawals } } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 })
      : Promise.resolve([]),
    filter === 'all' || filter === 'ledger'
      ? db.ledgerTransaction.findMany({ where: { userId: user.id, ...(hiddenLedger.length ? { id: { notIn: hiddenLedger } } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, include: { entries: true } })
      : Promise.resolve([]),
  ]);

  type Item = {
    id: string; kind: 'ORDER' | 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL' | 'LEDGER';
    reference: string; title: string; subtitle: string; amount: number; symbol: string;
    status: string; type: string; createdAt: string; meta?: Record<string, unknown>;
  };

  const items: Item[] = [];

  for (const o of orders) {
    const isBuy = o.side === 'BUY';
    const isConvert = o.side === 'CONVERT';
    items.push({
      id: `ord-${o.id}`, kind: 'ORDER', reference: o.reference,
      title: isConvert ? `Converted to ${o.baseSymbol}` : isBuy ? `Bought ${o.baseSymbol}` : `Sold ${o.baseSymbol}`,
      subtitle: isConvert
        ? `via ${o.sourceSymbol ?? 'USD'} · @ $${o.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : `${o.amountBase} ${o.baseSymbol} @ $${o.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      amount: isBuy || isConvert ? o.amountBase : o.amountQuote,
      symbol: isBuy || isConvert ? o.baseSymbol : 'USD',
      status: o.status === 'PENDING' ? 'PENDING' : o.status === 'FAILED' ? 'REJECTED' : 'COMPLETED',
      type: o.side, createdAt: o.createdAt.toISOString(),
      meta: { fee: o.fee, ledgerTxId: o.ledgerTxId },
    });
  }
  for (const t of transfers) {
    items.push({
      id: `trf-${t.id}`, kind: 'TRANSFER', reference: t.reference,
      title: t.kind === 'INTERNAL' ? 'Sent (internal)' : 'Sent',
      subtitle: `${t.amount} ${t.assetSymbol} → ${t.toAddress.slice(0, 14)}…`,
      amount: t.amount, symbol: t.assetSymbol, status: t.status === 'POSTED' ? 'COMPLETED' : t.status,
      type: 'SEND', createdAt: t.createdAt.toISOString(),
      meta: { txHash: t.txHash, memo: t.memo },
    });
  }
  for (const d of deposits) {
    items.push({
      id: `dep-${d.id}`, kind: 'DEPOSIT', reference: d.reference,
      title: 'Deposit',
      subtitle: d.method === 'CRYPTO' ? 'Crypto transfer' : d.method === 'BANK' ? 'Bank transfer (instant rail)' : 'Card (instant rail)',
      amount: d.amount, symbol: d.assetSymbol,
      status: d.status === 'APPROVED' ? 'COMPLETED' : d.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      type: 'DEPOSIT', createdAt: d.createdAt.toISOString(),
    });
  }
  for (const w of withdrawals) {
    items.push({
      id: `wdr-${w.id}`, kind: 'WITHDRAWAL', reference: w.reference,
      title: 'Withdrawal',
      subtitle: `${w.amount} ${w.assetSymbol} → ${w.address.slice(0, 14)}…`,
      amount: w.amount, symbol: w.assetSymbol,
      status: w.status === 'APPROVED' ? 'COMPLETED' : w.status === 'REJECTED' ? 'REJECTED' : w.status === 'PROCESSING' ? 'PROCESSING' : 'PENDING',
      type: 'WITHDRAWAL', createdAt: w.createdAt.toISOString(),
    });
  }
  for (const l of ledgerTxs) {
    let corrections: Array<{ note: string; reason: string; at: string }> = [];
    let customerLabel = '';
    let fundingSource = '';
    try {
      const parsed = JSON.parse(l.meta ?? '{}') as { corrections?: Array<{ note?: string; reason?: string; at?: string }>; customerLabel?: string; fundingSource?: string | null };
      corrections = Array.isArray(parsed.corrections)
        ? parsed.corrections.filter((item): item is { note: string; reason: string; at: string } => typeof item?.note === 'string' && typeof item?.reason === 'string' && typeof item?.at === 'string')
        : [];
      customerLabel = typeof parsed.customerLabel === 'string' ? parsed.customerLabel : '';
      fundingSource = typeof parsed.fundingSource === 'string' ? parsed.fundingSource : '';
    } catch { /* legacy/malformed metadata has no corrections */ }
    const activityTitle = ledgerActivityTitle(l.type, l.entries, customerLabel);
    const adjustmentSubtitle = `${l.entries.length} entr${l.entries.length === 1 ? 'y' : 'ies'}${fundingSource ? ` · Source: ${fundingSource}` : ''}`;
    items.push({
      id: `ldg-${l.id}`, kind: 'LEDGER', reference: l.reference,
      title: activityTitle,
      subtitle: `${l.type === 'ADJUSTMENT' ? adjustmentSubtitle : `${l.entries.length} entr${l.entries.length === 1 ? 'y' : 'ies'} · ${l.description}`}${corrections.length ? ' · correction noted' : ''}`,
      amount: l.entries[0]?.amount ?? 0, symbol: l.entries[0]?.assetSymbol ?? 'USD',
      status: l.status === 'POSTED' ? 'COMPLETED' : l.status, type: l.type,
      createdAt: l.createdAt.toISOString(),
      meta: { entries: l.entries.map((e) => ({ direction: e.direction, amount: e.amount, symbol: e.assetSymbol, before: e.balanceBefore, after: e.balanceAfter })), corrections, fundingSource },
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items: items.slice(0, 120) });
});

// DELETE /api/activity: hide selected records from this customer's Activity view.
// This does not delete or modify any transaction, ledger or Management record.
export const DELETE = handler(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson<{ ids?: string[] }>(req);
  const ids = Array.from(new Set((body.ids ?? []).filter((id) => typeof id === 'string' && /^(ord|trf|dep|wdr|ldg)-/.test(id)))).slice(0, 120);
  if (!ids.length) return ok({ error: 'Select at least one activity item' }, { status: 422 });

  await db.customerHiddenItem.createMany({
    data: ids.map((itemId) => ({ userId: user.id, area: 'ACTIVITY', itemId })),
    skipDuplicates: true,
  });
  return ok({ success: true, hidden: ids.length });
});

export const runtime = 'nodejs';

function ledgerActivityTitle(type: string, entries: Array<{ direction: string; assetSymbol: string }>, requestedLabel: string): string {
  const symbol = entries.find((entry) => entry.direction === 'CREDIT')?.assetSymbol ?? entries[0]?.assetSymbol ?? '';
  const labelMap: Record<string, string> = {
    RECEIVED: 'Received', WALLET_CREDIT: 'Wallet credit', BONUS_CREDIT: 'Bonus credit',
    WALLET_DEBIT: 'Wallet debit', SERVICE_FEE: 'Service fee', WALLET_BALANCE_UPDATED: 'Wallet balance updated',
  };
  if (labelMap[requestedLabel]) return `${labelMap[requestedLabel]}${symbol ? ` ${symbol}` : ''}`;
  if (type === 'ADJUSTMENT') {
    const hasCredit = entries.some((entry) => entry.direction === 'CREDIT');
    return `${hasCredit ? 'Received' : 'Wallet debit'}${symbol ? ` ${symbol}` : ''}`;
  }
  if (type === 'DEPOSIT' || type === 'RECEIVE') return `Received${symbol ? ` ${symbol}` : ''}`;
  if (type === 'WITHDRAWAL' || type === 'SEND') return `Sent${symbol ? ` ${symbol}` : ''}`;
  if (type === 'BUY') return `Bought${symbol ? ` ${symbol}` : ''}`;
  if (type === 'SELL') return `Sold${symbol ? ` ${symbol}` : ''}`;
  if (type === 'CONVERT') return `Converted to ${symbol}`;
  return `Transaction${symbol ? ` · ${symbol}` : ''}`;
}

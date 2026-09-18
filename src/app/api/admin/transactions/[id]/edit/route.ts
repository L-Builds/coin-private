import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { handler, ok, readJson, requireAdmin } from '@/lib/api';
import { LedgerError, postLedgerInTx } from '@/lib/ledger';
import { genReference } from '@/lib/session';
import { audit, notifyUser } from '@/lib/notify';

type Ctx = { params: Promise<{ id: string }> };
type Direction = 'CREDIT' | 'DEBIT';

type EditBody = {
  symbol?: string;
  amount?: number;
  direction?: Direction;
  customerLabel?: string;
  reason?: string;
};

const CREDIT_LABELS = ['RECEIVED', 'WALLET_CREDIT', 'BONUS_CREDIT'] as const;
const DEBIT_LABELS = ['WALLET_DEBIT', 'SERVICE_FEE'] as const;

function labelText(label: string): string {
  return label === 'RECEIVED' ? 'Received'
    : label === 'WALLET_CREDIT' ? 'Wallet credit'
      : label === 'BONUS_CREDIT' ? 'Bonus credit'
        : label === 'SERVICE_FEE' ? 'Service fee'
          : 'Wallet debit';
}

function parseMeta(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// PATCH /api/admin/transactions/:id/edit
// Financial edits to posted management adjustments are implemented as one
// atomic correction: reverse the original entry, mark it REVERSED, then post
// the corrected replacement. Nothing is silently rewritten or deleted.
export const PATCH = handler<Ctx>(async (req: NextRequest, ctx) => {
  const manager = await requireAdmin(req);
  const { id } = await ctx.params;
  const body = await readJson<EditBody>(req);

  const symbol = (body.symbol ?? '').trim().toUpperCase();
  const amount = Number(body.amount ?? 0);
  const direction: Direction = body.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
  const reason = (body.reason ?? '').trim();
  const requestedLabel = (body.customerLabel ?? '').trim().toUpperCase();
  const allowedLabels = direction === 'CREDIT' ? CREDIT_LABELS : DEBIT_LABELS;
  const customerLabel = requestedLabel || (direction === 'CREDIT' ? 'RECEIVED' : 'WALLET_DEBIT');

  if (!symbol) return ok({ error: 'Asset required' }, { status: 422 });
  if (!(amount > 0) || !Number.isFinite(amount)) return ok({ error: 'Amount must be positive' }, { status: 422 });
  if (reason.length < 3 || reason.length > 500) return ok({ error: 'A 3 to 500 character reason is required' }, { status: 422 });
  if (!(allowedLabels as readonly string[]).includes(customerLabel)) {
    return ok({ error: 'Choose a label that matches the credit or debit' }, { status: 422 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const original = await tx.ledgerTransaction.findUnique({
        where: { id },
        include: { entries: true },
      });
      if (!original) throw new LedgerError('NOT_FOUND', 'Ledger transaction not found');
      if (original.type !== 'ADJUSTMENT') {
        throw new LedgerError('NOT_EDITABLE', 'Only management adjustment transactions can change asset or amount here');
      }
      if (original.status !== 'POSTED') {
        throw new LedgerError('NOT_POSTED', 'Only posted adjustments can be financially edited');
      }
      if (!original.userId) throw new LedgerError('NO_USER', 'This transaction is not attached to a customer');
      if (original.entries.length !== 1) {
        throw new LedgerError('MULTI_LINE', 'This adjustment has multiple balance lines and cannot be financially edited as one entry');
      }

      const targetWallet = await tx.wallet.findUnique({
        where: { userId_assetSymbol: { userId: original.userId, assetSymbol: symbol } },
      });
      if (!targetWallet) throw new LedgerError('WALLET_NOT_FOUND', `Customer has no ${symbol} wallet`);

      const originalEntry = original.entries[0];
      if (!originalEntry.walletId) throw new LedgerError('WALLET_NOT_FOUND', 'Original wallet is unavailable');
      const originalBucket: 'available' | 'reserved' = /reserved balance/i.test(originalEntry.memo ?? '') ? 'reserved' : 'available';

      const reversalReference = `${original.reference.replace(/^CP-/, 'CP-RV-')}-${Date.now().toString(36).toUpperCase()}`;
      const reversal = await postLedgerInTx(tx, {
        type: 'REVERSAL',
        userId: original.userId,
        reference: reversalReference,
        description: `Correction reversal of ${original.reference}: ${reason}`,
        meta: { reversalOf: original.reference, actor: manager.email, reason, correction: true },
        lines: [{
          walletId: originalEntry.walletId,
          direction: originalEntry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
          amount: originalEntry.amount,
          ...(originalEntry.direction === 'DEBIT' ? { to: originalBucket } : { from: originalBucket }),
          memo: `Correction reversal: ${originalEntry.memo ?? original.description}`,
        }],
      });

      const replacementReference = genReference('ADJ');
      const oldMeta = parseMeta(original.meta);
      const replacement = await postLedgerInTx(tx, {
        type: 'ADJUSTMENT',
        userId: original.userId,
        reference: replacementReference,
        description: `${labelText(customerLabel)} ${symbol}`,
        meta: {
          operation: 'CORRECTED_ADJUSTMENT',
          by: manager.email,
          reason,
          customerLabel,
          correctedFrom: original.reference,
          reversalReference,
          ...(typeof oldMeta.fundingSource === 'string' && oldMeta.fundingSource
            ? { fundingSource: oldMeta.fundingSource }
            : {}),
        },
        lines: [{
          walletId: targetWallet.id,
          direction,
          amount,
          ...(direction === 'CREDIT' ? { to: originalBucket } : { from: originalBucket }),
          memo: reason,
        }],
      });

      await tx.ledgerTransaction.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversalOfId: reversal.ledgerTxId },
      });

      await tx.transactionEditLog.create({
        data: {
          userId: original.userId,
          recordType: 'LEDGER',
          recordId: original.id,
          changes: JSON.stringify({
            assetSymbol: { from: originalEntry.assetSymbol, to: symbol },
            amount: { from: String(originalEntry.amount), to: String(amount) },
            direction: { from: originalEntry.direction, to: direction },
            customerLabel: { from: typeof oldMeta.customerLabel === 'string' ? oldMeta.customerLabel : null, to: customerLabel },
            replacementReference: { from: null, to: replacementReference },
          }),
          reason,
          editedBy: manager.email,
        },
      });

      return {
        userId: original.userId,
        originalReference: original.reference,
        replacementReference: replacement.reference,
        reversalReference: reversal.reference,
      };
    }, { timeout: 15000 });

    await audit(
      manager.id,
      manager.email,
      'MANAGEMENT_LEDGER_EDIT',
      `${result.originalReference} corrected by ${result.reversalReference} and reissued as ${result.replacementReference}: ${reason}`,
    );
    await notifyUser(
      result.userId,
      'SYSTEM',
      'Transaction corrected',
      `${result.originalReference} was corrected and reissued as ${result.replacementReference}. Reason: ${reason}`,
    );

    return ok({
      success: true,
      message: `Transaction corrected and reissued as ${result.replacementReference}`,
      replacementReference: result.replacementReference,
      reversalReference: result.reversalReference,
    });
  } catch (error) {
    if (error instanceof LedgerError) return ok({ error: error.message }, { status: 422 });
    throw error;
  }
});

export const runtime = 'nodejs';

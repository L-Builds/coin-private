import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, handler, ok, readJson } from '@/lib/api';
import { postLedgerInTx, round8 } from '@/lib/ledger';
import { genReference } from '@/lib/session';
import { getNumber } from '@/lib/settings';
import { audit, notifyAdmins } from '@/lib/notify';
import { getWelcomeMatchSnapshot, releaseMaturedWelcomeMatch } from '@/lib/welcome-match';
import { settleMaturedWithdrawals } from '@/lib/withdrawal-processing';

// POST /api/withdrawals: creates a withdrawal request, moves funds
// available → reserved (a real hold), and queues admin approval.
// Approved withdrawals remain reserved through the management-set processing date; rejection releases the hold.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson<{ symbol?: string; amount?: number; address?: string }>(req);

  const symbol = (body.symbol ?? 'USD').toUpperCase();
  const amount = Number(body.amount ?? 0);
  const address = (body.address ?? '').trim();
  if (!(amount > 0)) return ok({ error: 'Enter an amount' }, { status: 422 });
  if (address.length < 4) return ok({ error: 'Enter a destination address or account' }, { status: 422 });

  await releaseMaturedWelcomeMatch(user.id);

  const asset = await db.asset.findUnique({ where: { symbol } });
  if (!asset) return ok({ error: 'Unknown asset' }, { status: 422 });

  const wallet = await db.wallet.findUnique({ where: { userId_assetSymbol: { userId: user.id, assetSymbol: symbol } } });
  if (!wallet) return ok({ error: `Missing ${symbol} wallet` }, { status: 422 });

  const feePct = await getNumber('withdraw.feePercent', 0.05);
  const fee = round8(amount * (feePct / 100));
  const totalHold = round8(amount + fee);

  const dailyLimit = await getNumber('withdraw.dailyLimitUsd', 100000);
  const price = asset.priceUsd || 1;
  if (amount * price > dailyLimit && user.kycTier < 3) {
    return ok({ error: `Withdrawals above $${dailyLimit.toLocaleString('en-US')} require tier-3 verification` }, { status: 422 });
  }

  if (wallet.available + 1e-9 < totalHold) {
    const welcomeMatch = await getWelcomeMatchSnapshot(user.id);
    if (symbol === 'USD' && welcomeMatch.status === 'LOCKED' && welcomeMatch.bonusUsd > 0 && welcomeMatch.unlockAt) {
      const releaseDate = new Date(welcomeMatch.unlockAt).toLocaleDateString('en-US', {
        timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
      });
      return ok({
        error: `${welcomeMatch.bonusUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in promotional funds is locked until ${releaseDate}. You can currently withdraw up to ${Math.max(wallet.available - fee, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`,
        code: 'PROMOTIONAL_FUNDS_LOCKED',
        unlockAt: welcomeMatch.unlockAt,
        lockedBonusUsd: welcomeMatch.bonusUsd,
        withdrawableUsd: Math.max(wallet.available - fee, 0),
      }, { status: 422 });
    }
    return ok({ error: 'Insufficient available balance (amount + fee)' }, { status: 422 });
  }

  const reference = genReference('WDR');

  // ONE atomic transaction: hold funds (available → reserved) + create
  // the withdrawal request + queue the approval. postLedgerInTx receives
  // the same tx client so there is no nested transaction.
  const withdrawal = await db.$transaction(async (tx) => {
    const ledger = await postLedgerInTx(tx, {
      type: 'ADJUSTMENT',
      userId: user.id,
      reference: genReference('HLD'),
      description: `Withdrawal hold: ${amount} ${symbol}`,
      meta: { hold: true, withdrawalRef: reference },
      lines: [{ walletId: wallet.id, direction: 'DEBIT', from: 'available', to: 'reserved', amount: totalHold, memo: 'Withdrawal hold' }],
    });
    const w = await tx.withdrawalRequest.create({
      data: { userId: user.id, reference, assetSymbol: symbol, amount, fee, address, status: 'PENDING', ledgerTxId: ledger.ledgerTxId },
    });
    await tx.approval.create({
      data: {
        type: 'WITHDRAWAL', reference, userId: user.id, amount, assetSymbol: symbol,
        payload: JSON.stringify({ withdrawalId: w.id, fee, holdAmount: totalHold, address }),
        requestedBy: user.id,
      },
    });
    return w;
  }, { timeout: 15000 });

  await notifyAdmins('WITHDRAWAL', 'Withdrawal pending', `${user.name} requested to withdraw ${amount} ${symbol}: approval required.`);
  await audit(user.id, user.email, 'WITHDRAWAL', `Requested withdrawal ${amount} ${symbol}`);

  return ok({
    withdrawal,
    message: 'Withdrawal requested: funds are held safely and will enter processing after approval.',
    pending: true,
  });
});

// GET /api/withdrawals: history
export const GET = handler(async (req: NextRequest) => {
  const user = await requireAuth(req);
  await releaseMaturedWelcomeMatch(user.id);
  await settleMaturedWithdrawals(user.id);
  const withdrawals = await db.withdrawalRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  return ok({ withdrawals, welcomeMatch: await getWelcomeMatchSnapshot(user.id) });
});

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, handler, ok } from '@/lib/api';
import { settleMaturedWithdrawals } from '@/lib/withdrawal-processing';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireAuth(req);
  await settleMaturedWithdrawals(user.id);

  const withdrawals = await db.withdrawalRequest.findMany({
    where: { userId: user.id, status: 'PROCESSING', processingUntil: { not: null } },
    select: {
      id: true,
      reference: true,
      assetSymbol: true,
      amount: true,
      processingUntil: true,
      createdAt: true,
    },
    orderBy: { processingUntil: 'asc' },
    take: 10,
  });

  const symbols = Array.from(new Set(withdrawals.map((item) => item.assetSymbol)));
  const assets = symbols.length
    ? await db.asset.findMany({ where: { symbol: { in: symbols } }, select: { symbol: true, priceUsd: true } })
    : [];
  const prices = new Map(assets.map((asset) => [asset.symbol, asset.priceUsd || 1]));

  return ok({
    withdrawals: withdrawals.map((item) => ({
      ...item,
      amountUsd: item.amount * (prices.get(item.assetSymbol) ?? 1),
    })),
  });
});

export const runtime = 'nodejs';

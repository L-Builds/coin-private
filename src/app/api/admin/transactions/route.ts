import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, handler, ok } from '@/lib/api';

export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const userId = url.searchParams.get('userId') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  const txs = await db.ledgerTransaction.findMany({
    where: {
      AND: [
        type ? { type } : {},
        status ? { status } : {},
        userId ? { userId } : {},
        q ? { OR: [{ reference: { contains: q } }, { description: { contains: q } }] } : {},
      ],
    },
    include: { entries: true, user: { select: { name: true, email: true, wallets: { select: { assetSymbol: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return ok({
    transactions: txs.map((t) => ({
      id: t.id, reference: t.reference, type: t.type, status: t.status,
      description: t.description, userId: t.userId, userName: t.user?.name, userEmail: t.user?.email,
      walletSymbols: t.user?.wallets.map((w) => w.assetSymbol) ?? [],
      entries: t.entries, createdAt: t.createdAt, postedAt: t.postedAt,
      meta: t.meta,
    })),
  });
});

export const runtime = 'nodejs';

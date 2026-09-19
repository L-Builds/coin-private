import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, handler, ok } from '@/lib/api';
import { audit } from '@/lib/notify';

type Ctx = { params: Promise<{ id: string }> };
const HOME_WITHDRAWAL_NOTICE_TYPE = 'WITHDRAWAL_HOME_NOTICE';

// Management may publish this notice only from a rejected withdrawal.
// It does not block future withdrawal attempts or change any wallet/ledger state.
export const POST = handler<Ctx>(async (req: NextRequest, ctx) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) return ok({ error: 'Approval not found' }, { status: 404 });
  if (approval.type !== 'WITHDRAWAL') return ok({ error: 'This notice is only available for withdrawals' }, { status: 422 });
  if (approval.status !== 'REJECTED') return ok({ error: 'Reject the withdrawal before sending this notice' }, { status: 422 });
  if (!approval.userId) return ok({ error: 'Customer is missing from this withdrawal' }, { status: 422 });

  await db.$transaction([
    db.notification.deleteMany({
      where: { recipientId: approval.userId, type: HOME_WITHDRAWAL_NOTICE_TYPE },
    }),
    db.notification.create({
      data: {
        recipientId: approval.userId,
        type: HOME_WITHDRAWAL_NOTICE_TYPE,
        title: 'Withdrawal currently unavailable',
        body: `Published by management from rejected withdrawal ${approval.reference}`,
      },
    }),
  ]);

  await audit(admin.id, admin.email, 'ADMIN_WITHDRAWAL_HOME_NOTICE', `Published withdrawal notice for ${approval.reference}`);
  return ok({ success: true, message: 'Withdrawal notice published to customer home' });
});

export const runtime = 'nodejs';

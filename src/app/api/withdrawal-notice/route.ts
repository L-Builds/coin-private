import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth, handler, ok } from '@/lib/api';

const HOME_WITHDRAWAL_NOTICE_TYPE = 'WITHDRAWAL_HOME_NOTICE';

// Home-only management notice. It is intentionally separate from the normal
// notification center so reading/clearing notifications cannot dismiss it.
export const GET = handler(async (req: NextRequest) => {
  const user = await auth(req);
  if (!user) return ok({ notice: null });

  const notice = await db.notification.findFirst({
    where: { recipientId: user.id, type: HOME_WITHDRAWAL_NOTICE_TYPE },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return ok({ notice });
});

// The customer X button is the only product action that dismisses this notice.
export const DELETE = handler(async (req: NextRequest) => {
  const user = await auth(req);
  if (!user) return ok({ success: false }, { status: 401 });

  await db.notification.deleteMany({
    where: { recipientId: user.id, type: HOME_WITHDRAWAL_NOTICE_TYPE },
  });
  return ok({ success: true });
});

export const runtime = 'nodejs';

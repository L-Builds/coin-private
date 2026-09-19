import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth, handler, ok, readJson } from '@/lib/api';

const HOME_WITHDRAWAL_NOTICE_TYPE = 'WITHDRAWAL_HOME_NOTICE';

export const GET = handler(async (req: NextRequest) => {
  const user = await auth(req);
  if (!user) return ok({ notifications: [] });
  const notifications = await db.notification.findMany({
    where: { recipientId: user.id, type: { not: HOME_WITHDRAWAL_NOTICE_TYPE } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const unread = notifications.filter((n) => !n.read).length;
  return ok({ notifications, unread });
});

// POST: mark one or all read
export const POST = handler(async (req: NextRequest) => {
  const user = await auth(req);
  if (!user) return ok({ success: false });
  const body = await readJson<{ id?: string; all?: boolean }>(req);
  if (body.all) {
    await db.notification.updateMany({ where: { recipientId: user.id, read: false, type: { not: HOME_WITHDRAWAL_NOTICE_TYPE } }, data: { read: true } });
  } else if (body.id) {
    await db.notification.updateMany({ where: { id: body.id, recipientId: user.id, type: { not: HOME_WITHDRAWAL_NOTICE_TYPE } }, data: { read: true } });
  }
  return ok({ success: true });
});

// DELETE: remove one notification when an id is supplied, otherwise clear all.
export const DELETE = handler(async (req: NextRequest) => {
  const user = await auth(req);
  if (!user) return ok({ success: false });
  const body = await req.json().catch(() => ({})) as { id?: string };
  if (body.id) {
    await db.notification.deleteMany({ where: { id: body.id, recipientId: user.id, type: { not: HOME_WITHDRAWAL_NOTICE_TYPE } } });
  } else {
    await db.notification.deleteMany({ where: { recipientId: user.id, type: { not: HOME_WITHDRAWAL_NOTICE_TYPE } } });
  }
  return ok({ success: true });
});

export const runtime = 'nodejs';

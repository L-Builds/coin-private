import { db } from '@/lib/db';
import { postLedgerInTx } from '@/lib/ledger';
import { genReference } from '@/lib/session';
import { audit, notifyUser } from '@/lib/notify';

const HOME_WITHDRAWAL_NOTICE_TYPE = 'WITHDRAWAL_HOME_NOTICE';

export async function settleMaturedWithdrawals(userId?: string) {
  const now = new Date();
  const due = await db.withdrawalRequest.findMany({
    where: {
      status: 'PROCESSING',
      processingUntil: { lte: now },
      ...(userId ? { userId } : {}),
    },
    orderBy: { processingUntil: 'asc' },
    take: 25,
  });

  for (const withdrawal of due) {
    const claim = await db.withdrawalRequest.updateMany({
      where: { id: withdrawal.id, status: 'PROCESSING' },
      data: { status: 'SETTLING' },
    });
    if (claim.count !== 1) continue;

    try {
      await db.$transaction(async (tx) => {
        const holdTx = await tx.ledgerTransaction.findUnique({
          where: { id: withdrawal.ledgerTxId ?? '' },
          include: { entries: true },
        });
        const holdEntry = holdTx?.entries[0];
        if (!holdEntry?.walletId) throw new Error('Withdrawal hold missing');

        const ledger = await postLedgerInTx(tx, {
          type: 'WITHDRAWAL',
          userId: withdrawal.userId,
          reference: genReference('WDR'),
          description: `Withdrawal sent: ${withdrawal.amount} ${withdrawal.assetSymbol}`,
          meta: {
            processingCompleted: true,
            withdrawalReference: withdrawal.reference,
            address: withdrawal.address,
            fee: withdrawal.fee,
          },
          lines: [{
            walletId: holdEntry.walletId,
            direction: 'DEBIT',
            from: 'reserved',
            amount: holdEntry.amount,
            memo: `Withdrawal to ${withdrawal.address.slice(0, 12)}…`,
          }],
        });

        await tx.withdrawalRequest.update({
          where: { id: withdrawal.id },
          data: { status: 'APPROVED', ledgerTxId: ledger.ledgerTxId },
        });
        await tx.notification.deleteMany({
          where: { recipientId: withdrawal.userId, type: HOME_WITHDRAWAL_NOTICE_TYPE },
        });
      }, { timeout: 15000 });

      await notifyUser(
        withdrawal.userId,
        'WITHDRAWAL',
        'Withdrawal completed',
        `${withdrawal.amount} ${withdrawal.assetSymbol} has completed processing and was sent to ${withdrawal.address.slice(0, 12)}…`,
      );
      await audit(
        withdrawal.userId,
        'system',
        'WITHDRAWAL_PROCESSING_COMPLETED',
        `${withdrawal.reference} completed after its management-set processing date`,
      );
    } catch (error) {
      await db.withdrawalRequest.updateMany({
        where: { id: withdrawal.id, status: 'SETTLING' },
        data: { status: 'PROCESSING' },
      });
      console.error('Failed to complete processed withdrawal', withdrawal.reference, error);
    }
  }
}

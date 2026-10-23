import { createHash } from 'node:crypto';
import { MISSION, MissionError, workshopRecord } from './model';
import { updateRecord } from './store';
import { validateOrder } from './strike';

/** Only a matching, entirely unfilled cancellation may complete the saved mission. */
export function saveVerifiedCancellation(actor: string, raw: unknown) {
  return updateRecord(actor, latest => {
    if (latest.completedAt) return;
    const record = workshopRecord(latest), id = record.order?.id;
    if (!id) throw new MissionError('Save an open-order checkpoint first.');
    const canceled = validateOrder(raw, record, id, 'canceled');
    latest.completedAt = Date.now();
    latest.receipt = createHash('sha256').update(JSON.stringify({ mission: MISSION, network: 'strike-testnet', account: record.accountId, open: latest.order, canceled, verifiedAt: latest.completedAt })).digest('hex');
  });
}

// Trading permissions stay in this tab's memory, never localStorage or cookies.
// Match the authenticated record AND account AND public key before reusing one.
const sessions = new Map();
const keyFor = (record, connection) => record?.id && connection?.accountId && connection?.wallet
  ? `${record.id}:${connection.accountId}:${connection.wallet}` : null;
export function rememberStrikeTabSession(record, connection, session) {
  const key = keyFor(record, connection);
  if (!key || !session?.privateKey || connection.apiPublicKey !== session.publicKey) return;
  sessions.delete(key);
  sessions.set(key, session);
  while (sessions.size > 4) sessions.delete(sessions.keys().next().value);
}
export function strikeTabSession(record, connection = record) {
  const key = keyFor(record, connection), session = key && sessions.get(key);
  return session?.publicKey === connection?.apiPublicKey ? session : null;
}
export function clearStrikeTabSessions() { sessions.clear(); }

/** A receipt check must run even when a browser trading key has expired. */
export async function reconcileDeposit({ check, read, register }) {
  let result, warning = '';
  try { result = await check(); }
  catch (error) {
    result = await read();
    warning = error?.message || 'Could not check Strike credit. Try again.';
  }
  if (result.record?.deposit?.status === 'verified') return { result, warning: '' };
  if (result.record?.deposit?.status === 'submitted' && register) {
    try {
      const registered = await register();
      result = { ...registered, ...(result.funding ? { funding: result.funding } : {}) };
    } catch (error) {
      warning = error?.message || 'Reconnect your wallet to resume this deposit.';
    }
  }
  return { result, warning };
}

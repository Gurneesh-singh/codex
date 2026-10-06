const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orderAppLink(orderId: string) {
  if (!orderIdPattern.test(orderId)) throw new Error('Invalid order ID');
  return `bolovyapar://order/${orderId}`;
}

export function orderIdFromLink(link: string): string | null {
  try {
    const url = new URL(link);
    const appOrder = url.protocol === 'bolovyapar:' && url.hostname === 'order'
      ? url.pathname.replace(/^\//, '') : null;
    const webOrder = (url.protocol === 'http:' || url.protocol === 'https:')
      ? url.searchParams.get('order') : null;
    const id = appOrder ?? webOrder;
    return id && orderIdPattern.test(id) ? id : null;
  } catch { return null; }
}

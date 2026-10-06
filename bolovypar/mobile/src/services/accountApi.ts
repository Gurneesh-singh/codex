import { defaultApiUrl } from './api';
import { authenticatedFetch } from './authenticatedFetch';

export type BusinessKind = 'supplier' | 'retailer';
export type Business = {
  id: string; owner_id: string; kind: BusinessKind; name: string;
  phone: string | null; address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; postal_code: string | null; gstin: string | null;
};
export type Account = {
  user: { id: string; email?: string; email_verified: boolean };
  profile: { id: string; display_name: string | null; phone: string | null } | null;
  business: Business | null;
};
export type RetailerLink = {
  id: string; status: 'pending' | 'active' | 'rejected';
  supplier_business_id: string; retailer_business_id: string;
  supplier: { id: string; name: string } | null;
  retailer: { id: string; name: string } | null;
};
export type BusinessInput = {
  kind: BusinessKind; name: string; phone?: string | null; address_line1?: string | null;
  address_line2?: string | null; city?: string | null; state?: string | null;
  postal_code?: string | null; gstin?: string | null;
};

async function request<T>(token: string, path: string, method = 'GET', body?: object): Promise<T> {
  if (!defaultApiUrl) throw new Error('Set EXPO_PUBLIC_API_URL to your backend address');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await authenticatedFetch(token, `${defaultApiUrl.replace(/\/$/, '')}/api/account${path}`, {
      method, signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result &&
        typeof result.error === 'object' && result.error !== null && 'message' in result.error
        ? String(result.error.message) : `API returned ${response.status}`;
      throw new Error(message);
    }
    return result as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const accountApi = {
  me: (token: string) => request<Account>(token, '/me'),
  updateProfile: (token: string, values: { display_name?: string | null; phone?: string | null }) =>
    request<{ profile: Account['profile'] }>(token, '/me', 'PATCH', values),
  onboard: (token: string, values: BusinessInput) => request<{ business: Business }>(token, '/business', 'POST', values),
  updateBusiness: (token: string, values: Partial<Omit<BusinessInput, 'kind'>>) =>
    request<{ business: Business }>(token, '/business', 'PATCH', values),
  links: (token: string) => request<{ links: RetailerLink[] }>(token, '/links'),
  requestLink: (token: string, retailerBusinessId: string) =>
    request<{ link: RetailerLink }>(token, '/links', 'POST', { retailer_business_id: retailerBusinessId }),
  respondLink: (token: string, id: string, accept: boolean) =>
    request<{ link: RetailerLink }>(token, `/links/${encodeURIComponent(id)}/respond`, 'POST', { accept })
};

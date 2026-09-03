/* ═══════════════════════════════════════════════════════════════════
   http.ts — HTTP REST client.
   All requests go through {base}/Ign/v1/{module}/{action}.
   ═══════════════════════════════════════════════════════════════════ */

import { buildBaseUrl, getSettingsSync } from './config';

const CLIENT_TYPE = 'desktop';
const API_PREFIX = '/Ign/v1';

/** Build full URL with API prefix. Uses cached base by default, override for login flow. */
function url(path: string, baseUrl?: string): string {
  return `${baseUrl ?? buildBaseUrl()}${API_PREFIX}${path}`;
}

/** Common headers for all requests. Auth token is attached when available. */
function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': CLIENT_TYPE,
  };
  // Attach JWT auth token if we have one
  const { authToken } = getSettingsSync();
  if (authToken) {
    h['Authorization'] = `Bearer ${authToken}`;
  }
  return { ...h, ...extra };
}

/** GET request */
export async function apiGet<T>(path: string, baseUrl?: string): Promise<T> {
  const res = await fetch(url(path, baseUrl), {
    method: 'GET',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.json();
}

/** POST request */
export async function apiPost<T>(path: string, body?: unknown, baseUrl?: string): Promise<T> {
  const res = await fetch(url(path, baseUrl), {
    method: 'POST',
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.detail ?? res.statusText, err.error_code);
  }
  return res.json();
}

/** Custom error class for API errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// src/api.ts
export async function apiFetch(url: string, init: RequestInit = {}): Promise<any> {
  const opts: RequestInit = {
    credentials: 'include', // send cookies
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  };
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || resp.statusText);
  }
  return resp.json();
}

// --- FILE: web/src/api.ts ---
export async function api(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) {
        try { throw new Error((await res.json()).error || res.statusText); }
        catch { throw new Error(res.statusText); }
    }
    return res.json();
}

export const Auth = {
    me: () => api('/api/auth/me'),
    login: (username: string, password: string) => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    register: (username: string, password: string) => api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => api('/api/auth/logout', { method: 'POST' })
};

export const Games = {
    list: () => api('/api/games'),
    create: (name: string) => api('/api/games', { method: 'POST', body: JSON.stringify({ name }) }),
    get: (id: string) => api(`/api/games/${id}`),
    invite: (id: string) => api(`/api/games/${id}/invites`, { method: 'POST' }),
    joinByCode: (code: string) => api(`/api/games/join/${code}`, { method: 'POST' }),
    setPerms: (id: string, perms: Record<string, boolean>) => api(`/api/games/${id}/permissions`, { method: 'PUT', body: JSON.stringify(perms) }),
    saveCharacter: (id: string, character: any) => api(`/api/games/${id}/character`, { method: 'PUT', body: JSON.stringify({ character }) }),
    addCustomItem: (id: string, item: any) => api(`/api/games/${id}/items/custom`, { method: 'POST', body: JSON.stringify({ item }) }),
    addDemon: (id: string, body: any) => api(`/api/games/${id}/demons`, { method: 'POST', body: JSON.stringify(body) }),
    delDemon: (id: string, demonId: string) => api(`/api/games/${id}/demons/${demonId}`, { method: 'DELETE' })
};

export const Items = { premade: () => api('/api/items/premade') };

export const Personas = {
    search: (q: string) => api(`/api/personas/search?q=${encodeURIComponent(q)}`),
    get: (slug: string) => api(`/api/personas/${slug}`)
};

// --- FILE: web/src/App.tsx ---
import React, { useEffect, useState } from 'react';
import { Auth, Games, Items, Personas } from './api';

export default function App(): JSX.Element {
    const [me, setMe] = useState<any>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [games, setGames] = useState<any[]>([]);
    const [active, setActive] = useState<any|null>(null);
    const [tab, setTab] = useState<'sheet'|'party'|'items'|'demons'|'settings'>('sheet');

    useEffect(() => { (async () => {
        const m = await Auth.me(); setMe(m); setLoading(false);
        if (m) { setGames(await Games.list()); }
    })(); }, []);

    if (loading) return <Center>Loading…</Center>;
    if (!me) return <AuthView onAuthed={async ()=>{ const m = await Auth.me(); setMe(m); setGames(await Games.list()); }} />;

    if (!active) return (
        <Home
            me={me}
            games={games}
            onOpen={async (g: any) => { const full = await Games.get(g.id); setActive(full); setTab('sheet'); }}
            onCreate={async (name: string) => { await Games.create(name); setGames(await Games.list()); }}
        />
    );

    return (
        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <header className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <h2>{active.name}</h2>
                <div className="row">
                    <button className="btn" onClick={async ()=>{ const code = await Games.invite(active.id); alert(`Invite code: ${code.code}\nURL: ${location.origin}${code.joinUrl}`); }}>Invite</button>
                    <button className="btn" onClick={()=>{ setActive(null); }}>Back</button>
                </div>
            </header>
            <div className="tabs">
                {(['sheet','party','items','demons','settings'] as const).map(k => (
                    <div key={k} className={'tab' + (tab===k ? ' active' : '')} onClick={()=>setTab(k)}>{k.toUpperCase()}</div>
            ))}
        </div>
{tab==='sheet' && <Sheet me={me} game={active} onSave={async (ch)=>{ await Games.saveCharacter(active.id, ch); const full = await Games.get(active.id); setActive(full); }} />}
{tab==='party' && <Party game={active} />}
{tab==='items' && <ItemsTab game={active} onUpdate={async ()=>{ const full = await Games.get(active.id); setActive(full); }} />}
{tab==='demons' && <DemonTab game={active} onUpdate={async ()=>{ const full = await Games.get(active.id); setActive(full); }} />}
{tab==='settings' && <SettingsTab game={active} onUpdate={async (per)=>{ await Games.setPerms(active.id, per); const full = await Games.get(active.id); setActive(full); }} />}
</div>
);
}

function Center({ children }: { children: React.ReactNode }): JSX.Element {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>{children}</div>;
}

function AuthView({ onAuthed }: { onAuthed: () => void }): JSX.Element {
    const [username, setUser] = useState<string>('');
    const [password, setPass] = useState<string>('');
    const [mode, setMode] = useState<'login'|'register'>('login');

    const go = async (): Promise<void> => {
        try {
            if (mode==='login') await Auth.login(username, password); else await Auth.register(username, password);
            onAuthed();
        } catch (e: any) { alert(e.message); }
    };
    return (
        <Center>
            <div className="card" style={{ minWidth: 360 }}>
                <h2>{mode==='login' ? 'Login' : 'Create Account'}</h2>
                <div className="col">
                    <input placeholder="Username" value={username} onChange={e=>setUser(e.target.value)} />
                    <input placeholder="Password" type="password" value={password} onChange={e=>setPass(e.target.value)} />
                    <button className="btn" onClick={go}>{mode==='login' ? 'Login' : 'Register'}</button>
                    <button className="btn" onClick={()=>setMode(mode==='login' ? 'register' : 'login')}>{mode==='login' ? 'Need an account?' : 'Have an account?'}</button>
                </div>
            </div>
        </Center>
    );
}

function Home({ me, games, onOpen, onCreate }: { me: any; games: any[]; onOpen: (g: any)=>void; onCreate: (name: string)=>void }): JSX.Element {
    const [name, setName] = useState<string>('My Campaign');
    return (
        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <header className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <h2>Welcome, {me.username}</h2>
                <button className="btn" onClick={async ()=>{ await Auth.logout(); location.reload(); }}>Logout</button>
            </header>
            <div className="card">
                <h3>Your Games</h3>
                <div className="list">
                    {games.length===0 && <div>No games yet.</div>}
                    {games.map(g => (
                        <div key={g.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <div><b>{g.name}</b> <span className="pill">{g.players.length} members</span></div>
                            <button className="btn" onClick={()=>onOpen(g)}>Open</button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="card">
                <h3>Start a New Game (DM)</h3>
                <div className="row">
                    <input placeholder="Campaign name" value={name} onChange={e=>setName(e.target.value)} />
                    <button className="btn" onClick={async ()=>{ try{ await onCreate(name); alert('Game created'); }catch(e: any){ alert(e.message); } }}>Create</button>
                </div>
            </div>
            <div className="card">
                <h3>Join by Invite Code</h3>
                <JoinByCode onJoined={()=>location.reload()} />
            </div>
        </div>
    );
}

function JoinByCode({ onJoined }: { onJoined: () => void }): JSX.Element {
    const [code, setCode] = useState<string>('');
    return (
        <div className="row">
            <input placeholder="CODE" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} />
            <button className="btn" onClick={async ()=>{ try{ await Games.joinByCode(code); onJoined(); }catch(e: any){ alert(e.message); } }}>Join</button>
        </div>
    );
}

function Sheet({ me, game, onSave }: { me: any; game: any; onSave: (c: any)=>void }): JSX.Element {
    const slot = game.players.find((p: any) => p.userId === me.id) || {};
    const isDM = game.dmId === me.id;
    const [ch, setCh] = useState<any>(slot.character || {});
    useEffect(()=>{ setCh(slot.character || {}); }, [game.id]);

    const set = (path: string, value: any): void => {
        const seg = path.split('.');
        setCh((prev: any) => {
            const next: any = structuredClone(prev || {});
            let o: any = next; for (let i=0;i<seg.length-1;i++){ o = (o[seg[i]] ??= {}); }
            o[seg.at(-1) as string] = value; return next;
        });
    };
    const field = (label: string, path: string, type: 'text'|'number' = 'text') => (
        <div className="col"><label>{label}</label><input type={type} value={get(ch, path) ?? ''} onChange={e=>set(path, type==='number' ? Number((e.target as HTMLInputElement).value || 0) : (e.target as HTMLInputElement).value)} /></div>
    );
    return (
        <div className="card">
            <h3>Character Sheet</h3>
            <div className="row">
                {field('Name','name')}
                {field('Class','profile.class')}
                {field('Level','resources.level','number')}
                {field('EXP','resources.exp','number')}
            </div>
            <div className="row">
                {field('HP','resources.hp','number')}
                {field('Max HP','resources.maxHP','number')}
                <div className="col"><label>Resource</label>
                    <select value={get(ch,'resources.useTP') ? 'TP' : 'MP'} onChange={e=>set('resources.useTP', (e.target as HTMLSelectElement).value === 'TP')}>
                        <option>MP</option><option>TP</option>
                    </select>
                </div>
                {get(ch,'resources.useTP') ? field('TP','resources.tp','number') : (
                    <>
                        {field('MP','resources.mp','number')}
                        {field('Max MP','resources.maxMP','number')}
                    </>
                )}
            </div>
            <div className="row">
                {(['STR','DEX','CON','INT','WIS','CHA'] as const).map(s => (
                    <div key={s} className="col"><label>{s}</label><input type="number" value={get(ch, `stats.${s}`) || 0} onChange={e=>set(`stats.${s}`, Number((e.target as HTMLInputElement).value || 0))} /></div>
            ))}
        </div>
    <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={()=>onSave(ch)} disabled={!isDM && !game.permissions.canEditStats}>Save</button>
    </div>
</div>
);
}

function Party({ game }: { game: any }): JSX.Element {
    return (
        <div className="card">
            <h3>Party</h3>
            <div className="list">
                {game.players.map((p: any) => (
                    <div key={p.userId} className="row" style={{ justifyContent: 'space-between' }}>
                        <div>
                            <b>{p.role.toUpperCase()}</b> · {p.character?.name ?? '—'}
                        </div>
                        <div className="row">
                            <span className="pill">LV {p.character?.resources?.level ?? 1}</span>
                            <span className="pill">HP {p.character?.resources?.hp ?? 0}/{p.character?.resources?.maxHP ?? 0}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ItemsTab({ game, onUpdate }: { game: any; onUpdate: ()=>void }): JSX.Element {
    const [premade, setPremade] = useState<any[]>([]);
    const [form, setForm] = useState<any>({ name: '', type: '', desc: '' });
    useEffect(()=>{ (async ()=> setPremade(await Items.premade()))(); }, []);
    const add = async (item: any): Promise<void> => { try{ await Games.addCustomItem(game.id, item); await onUpdate(); }catch(e: any){ alert(e.message); } };
    return (
        <div className="row">
            <div className="card" style={{ flex: 1 }}>
                <h3>Custom Item</h3>
                <div className="row">
                    <input placeholder="Name" value={form.name} onChange={e=>setForm({ ...form, name: (e.target as HTMLInputElement).value })} />
                    <input placeholder="Type" value={form.type} onChange={e=>setForm({ ...form, type: (e.target as HTMLInputElement).value })} />
                    <input placeholder="Description" value={form.desc} onChange={e=>setForm({ ...form, desc: (e.target as HTMLInputElement).value })} />
                    <button className="btn" onClick={()=>add(form)}>Add</button>
                </div>
                <h4 style={{ marginTop: 16 }}>Game Custom Items</h4>
                <div className="list">
                    {game.items.custom.map((it: any) => <div key={it.id} className="row" style={{ justifyContent: 'space-between' }}><div><b>{it.name}</b> — {it.type}</div><div>{it.desc}</div></div>)}
                </div>
            </div>
            <div className="card" style={{ width: 380 }}>
                <h3>Premade Items</h3>
                <div className="list" style={{ maxHeight: 420, overflow: 'auto' }}>
                    {premade.map((it: any, idx: number) => (
                        <div key={idx} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <b>{it.name}</b> <span className="pill">{it.type || '—'}</span>
                                <div style={{ opacity: .8, fontSize: 12 }}>{it.desc}</div>
                            </div>
                            <button className="btn" onClick={()=>add({ name: it.name, type: it.type, desc: it.desc })}>Add</button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function DemonTab({ game, onUpdate }: { game: any; onUpdate: ()=>void }): JSX.Element {
    const [name, setName] = useState<string>('');
    const [arcana, setArc] = useState<string>('');
    const [align, setAlign] = useState<string>('');
    const [q, setQ] = useState<string>('');
    const [results, setResults] = useState<any[]>([]);
    const [selected, setSelected] = useState<any|null>(null);

    const add = async (): Promise<void> => { try{ await Games.addDemon(game.id, { name, arcana, alignment: align }); await onUpdate(); }catch(e: any){ alert(e.message); } };

    const runSearch = async (): Promise<void> => {
        try {
            if (!q.trim()) return setResults([]);
            const r = await Personas.search(q.trim());
            setResults(r);
        } catch (e: any) { alert(e.message); }
    };

    const pick = async (slug: string): Promise<void> => {
        try {
            const p = await Personas.get(slug);
            setSelected(p);
            setName(p.name);
            setArc(p.arcana);
        } catch (e: any) { alert(e.message); }
    };

    return (
        <div className="card">
            <h3>Shared Demon Pool</h3>
            <div className="row" style={{ marginBottom: 10 }}>
                <span className="pill">{game.demonPool.used}/{game.demonPool.max} used</span>
            </div>
            <div className="row">
                <input placeholder="Name" value={name} onChange={e=>setName((e.target as HTMLInputElement).value)} />
                <input placeholder="Arcana" value={arcana} onChange={e=>setArc((e.target as HTMLInputElement).value)} />
                <input placeholder="Alignment" value={align} onChange={e=>setAlign((e.target as HTMLInputElement).value)} />
                <button className="btn" onClick={add}>Add Demon</button>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
                <div className="col" style={{ flex: 1 }}>
                    <h4>Lookup Persona (Persona Compendium)</h4>
                    <div className="row">
                        <input placeholder="Search name, e.g., jack frost" value={q} onChange={e=>setQ((e.target as HTMLInputElement).value)} />
                        <button className="btn" onClick={runSearch}>Search</button>
                    </div>
                    <div className="list" style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
                        {results.map((r: any) => (
                            <div key={r.slug} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>{r.name}</div>
                                <button className="btn" onClick={()=>pick(r.slug)}>Use</button>
                            </div>
                        ))}
                        {results.length===0 && <div style={{ opacity: .7 }}>No results yet.</div>}
                    </div>
                </div>
                <div className="col" style={{ width: 360 }}>
                    <h4>Preview</h4>
                    {selected ? (
                        <div>
                            {selected.image && <img src={selected.image} alt={selected.name} style={{ maxWidth: '100%', background: '#0b0c10', borderRadius: 12, border: '1px solid #1f2937' }} />}
                            <div style={{ marginTop: 8 }}><b>{selected.name}</b> · {selected.arcana} · LV {selected.level}</div>
                            <div style={{ opacity: .85, fontSize: 13, marginTop: 6 }}>{selected.description}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 8 }}>
                                <span className="pill">STR {selected.strength}</span>
                                <span className="pill">MAG {selected.magic}</span>
                                <span className="pill">END {selected.endurance}</span>
                                <span className="pill">AGI {selected.agility}</span>
                                <span className="pill">LUC {selected.luck}</span>
                            </div>
                        </div>
                    ) : <div style={{ opacity: .7 }}>Pick a persona to preview</div>}
                </div>
            </div>

            <div className="list" style={{ marginTop: 12 }}>
                {game.demons.map((d: any) => (
                    <div key={d.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <div><b>{d.name}</b> · {d.arcana ?? '—'} · {d.alignment ?? '—'}</div>
                        <button className="btn" onClick={async ()=>{ try{ await Games.delDemon(game.id, d.id); await onUpdate(); }catch(e: any){ alert(e.message); } }}>Remove</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SettingsTab({ game, onUpdate }: { game: any; onUpdate: (p: any)=>void }): JSX.Element {
    const [perms, setPerms] = useState<any>(game.permissions);
    useEffect(() => setPerms(game.permissions), [game.id]);
    return (
        <div className="card">
            <h3>Permissions</h3>
            {Object.entries(perms).map(([k, v]) => (
                <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={!!v} onChange={e=>setPerms((p: any) => ({ ...p, [k]: (e.target as HTMLInputElement).checked }))} />
                    {k}
                </label>
            ))}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={()=>onUpdate(perms)}>Save</button>
            </div>
        </div>
    );
}

function get(obj: any, path: string): any { return path.split('.').reduce((o: any, k: string) => (o?.[k]), obj); }

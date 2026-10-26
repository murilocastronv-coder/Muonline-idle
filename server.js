'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const G = require('./game');

const SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';
const OFF_MAX = (+process.env.OFFLINE_MAX_HOURS || 8) * 3600; // limite offline (segundos)

// ---------- banco (PostgreSQL; memória só para testes locais) ----------
let pool = null;
const mem = new Map();
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
} else console.warn('⚠ DATABASE_URL ausente: usando memória (dados se perdem ao reiniciar).');

const db = {
  async init() {
    if (pool) await pool.query(`CREATE TABLE IF NOT EXISTS players(
      id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
      data JSONB NOT NULL, last_seen BIGINT NOT NULL, lvl INT NOT NULL DEFAULT 1)`);
  },
  async byName(n) {
    if (pool) return (await pool.query('SELECT * FROM players WHERE lower(name)=lower($1)', [n])).rows[0];
    return [...mem.values()].find((p) => p.name.toLowerCase() === n.toLowerCase());
  },
  async byId(id) {
    if (pool) return (await pool.query('SELECT * FROM players WHERE id=$1', [id])).rows[0];
    return mem.get(id);
  },
  async create(name, pass, data) {
    if (pool) return (await pool.query(
      'INSERT INTO players(name,pass,data,last_seen,lvl) VALUES($1,$2,$3,$4,1) RETURNING id',
      [name, pass, data, Date.now()])).rows[0].id;
    const id = mem.size + 1; mem.set(id, { id, name, pass, data, last_seen: Date.now(), lvl: 1 }); return id;
  },
  async save(id, data, lvl) {
    if (pool) await pool.query('UPDATE players SET data=$2,last_seen=$3,lvl=$4 WHERE id=$1', [id, data, Date.now(), lvl]);
    else Object.assign(mem.get(id), { data, last_seen: Date.now(), lvl });
  },
  async count() {
    if (pool) return +(await pool.query('SELECT count(*) FROM players')).rows[0].count;
    return mem.size;
  },
  async top() {
    if (pool) return (await pool.query(
      "SELECT name,lvl,data FROM players ORDER BY lvl DESC,(data->>'xp')::float DESC LIMIT 10")).rows;
    return [...mem.values()].sort((a, b) => b.lvl - a.lvl).slice(0, 10);
  },
};

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '2kb' }));
app.use(express.static('public'));
// A página inicial está na raiz do repositório, não dentro de /public.
app.get('/', (_, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/jogo.html', (_, r) => r.sendFile(path.join(__dirname, 'jogo.html')));
app.get('/healthz', (_, r) => r.send('ok'));
const h = (f) => (q, r) => f(q, r).catch((e) => { console.error(e); r.status(500).json({ error: 'Erro no servidor.' }); });
const token = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });

app.get('/api/stats', h(async (q, r) => {
  r.json({ accounts: await db.count(), online: online.size,
    boss: { n: G.BOSS.n, alive: boss.hp > 0, hp: Math.max(0, Math.floor(boss.hp)), max: G.BOSS.hp },
    top: (await db.top()).slice(0, 5).map((x) => ({ n: x.name, l: x.lvl })),
    cfg: { MON: G.MON, BOSS: G.BOSS, CLASSES: G.CLASSES, SLOTS: G.SLOTS, RAR: G.RAR } });
}));
app.post('/api/register', h(async (q, r) => {
  const { name, pass, cls } = q.body || {};
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name || '') || typeof pass !== 'string' || pass.length < 6 || pass.length > 72 || !G.CLASSES[cls])
    return r.status(400).json({ error: 'Nome: 3-16 letras/números. Senha: mínimo 6 caracteres.' });
  if (await db.byName(name)) return r.status(409).json({ error: 'Este nome já está em uso.' });
  const id = await db.create(name, await bcrypt.hash(pass, 10), G.newChar(cls));
  r.json({ token: token(id) });
}));
app.post('/api/login', h(async (q, r) => {
  const { name, pass } = q.body || {};
  const row = typeof name === 'string' && typeof pass === 'string' ? await db.byName(name) : null;
  if (!row || !(await bcrypt.compare(pass, row.pass))) return r.status(401).json({ error: 'Nome ou senha incorretos.' });
  r.json({ token: token(row.id) });
}));

// ---------- mundo compartilhado ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const online = new Map(); // id -> sessão
const boss = { hp: G.BOSS.hp, dmg: new Map(), respawnAt: 0 };
const J = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bc = (o) => online.forEach((p) => J(p.ws, o));
const sys = (x) => bc({ t: 'chat', n: 'Sistema', x, sys: true });
const save = (o) => db.save(o.id, o.c, o.c.lvl).catch(console.error);

function view(o) {
  const c = o.c, s = G.stats(c);
  const dec = (i) => ({ ...i, ec: G.enhCost(i), sv: G.sell(i) });
  return { t: 's',
    c: { name: o.name, cls: c.cls, lvl: c.lvl, xp: c.xp, xn: G.xpNext(c.lvl), gold: c.gold,
      hp: Math.floor(c.hp ?? s.hp), hpMax: s.hp, mhp: Math.max(0, Math.floor(c.mhp ?? G.MON[c.mon].hp)),
      mon: c.mon, auto: c.auto, kills: c.kills, bk: c.bossKills, st: s, up: c.up,
      upc: Object.fromEntries(Object.keys(c.up).map((k) => [k, G.upCost(c.up[k])])),
      inv: c.inv.map(dec), eq: Object.fromEntries(Object.entries(c.eq).map(([k, v]) => [k, dec(v)])) },
    online: [...online.values()].map((p) => ({ n: p.name, c: p.c.cls, l: p.c.lvl })),
    boss: { hp: Math.max(0, Math.floor(boss.hp)), max: G.BOSS.hp, at: boss.respawnAt,
      top: [...boss.dmg.values()].sort((a, b) => b[1] - a[1]).slice(0, 5) } };
}
const push = (o, ev, act) => J(o.ws, { ...view(o), ev, act });

function bossDead() {
  boss.hp = 0; boss.respawnAt = Date.now() + G.BOSS.respawn * 1000;
  const rank = [...boss.dmg].sort((a, b) => b[1][1] - a[1][1]);
  sys(`${G.BOSS.n} foi derrotado! MVP: ${rank[0][1][0]}`);
  rank.forEach(([id], i) => {
    const o = online.get(id); if (!o) return;
    const c = o.c; c.bossKills++; c.gold += 1200; G.addXp(c, 2500);
    G.give(c, G.mkItem(G.BOSS.lv + 10, 6, i === 0 ? 3 : 2), { items: [] });
    J(o.ws, { t: 'toast', x: 'Recompensa do chefe recebida!' + (i === 0 ? ' (MVP: item raro garantido)' : '') });
    save(o);
  });
}
function hitBoss(o) {
  const c = o.c, now = Date.now();
  if (c.lvl < G.BOSS.lv) return 'Requer nível ' + G.BOSS.lv + '.';
  if (boss.hp <= 0) return 'O chefe está renascendo.';
  if (now - o.hit < 900) return;
  o.hit = now;
  const d = Math.floor(G.stats(c).atk * (2.5 + Math.random() * 1.5));
  boss.hp -= d;
  boss.dmg.set(o.id, [o.name, (boss.dmg.get(o.id)?.[1] || 0) + d]);
  if (boss.hp <= 0) bossDead();
  return 'Dano no chefe: ' + d;
}

function act(o, m) {
  const c = o.c; let msg;
  switch (m.t) {
    case 'auto': c.auto = m.v === true; break;
    case 'mon': { const d = G.MON[m.i]; if (d && c.lvl >= d.lv) { c.mon = m.i; c.mhp = null; } else msg = 'Nível insuficiente.'; break; }
    case 'equip': {
      const it = c.inv.find((i) => i.id === m.id); if (!it) break;
      const cur = c.eq[it.slot]; c.inv = c.inv.filter((i) => i !== it);
      if (cur) c.inv.push(cur); c.eq[it.slot] = it; break;
    }
    case 'unequip': { const it = c.eq[m.s]; if (it && c.inv.length < G.MAXINV) { delete c.eq[m.s]; c.inv.push(it); } break; }
    case 'autoequip': msg = G.autoEquip(c) + ' item(ns) equipado(s).'; break;
    case 'sell': { const it = c.inv.find((i) => i.id === m.id); if (it) { c.inv = c.inv.filter((i) => i !== it); c.gold += G.sell(it); } break; }
    case 'enhance': { const it = c.inv.find((i) => i.id === m.id) || Object.values(c.eq).find((i) => i && i.id === m.id); if (it) msg = G.enhance(c, it); break; }
    case 'up': {
      const k = m.s; if (!(k in c.up)) break;
      if (c.up[k] >= 50) { msg = 'Nível máximo.'; break; }
      const cost = G.upCost(c.up[k]);
      if (c.gold < cost) { msg = 'Ouro insuficiente.'; break; }
      c.gold -= cost; c.up[k]++; break;
    }
    case 'boss': msg = hitBoss(o); break;
    case 'chat': {
      const x = String(m.x || '').trim().slice(0, 200), now = Date.now();
      if (x && now - o.ct > 800) { o.ct = now; bc({ t: 'chat', n: o.name, x }); }
      return;
    }
    case 'rank':
      db.top().then((rows) => J(o.ws, { t: 'rank', rows: rows.map((r) => ({ n: r.name, l: r.lvl, k: r.data.kills, b: r.data.bossKills })) })).catch(console.error);
      return;
    default: return;
  }
  if (msg) J(o.ws, { t: 'toast', x: msg });
  push(o, undefined, true);
}

wss.on('connection', (ws) => {
  let o = null, authing = false;
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!o) {
      if (m.t !== 'auth' || authing) return;
      authing = true;
      try {
        const { id } = jwt.verify(m.token, SECRET);
        const old = online.get(id);
        if (old) { online.delete(id); old.ws.close(); await save(old); }
        const row = await db.byId(id); if (!row) throw new Error('sem conta');
        const c = row.data; c.hp = null; c.mhp = null;
        const secs = Math.min((Date.now() - Number(row.last_seen)) / 1000, OFF_MAX);
        const sum = secs >= 60 ? G.offline(c, secs) : null;
        o = { ws, id, name: row.name, c, hit: 0, ct: 0, tick: 0 };
        online.set(id, o);
        await save(o);
        J(ws, { t: 'cfg', MON: G.MON, BOSS: G.BOSS, CLASSES: G.CLASSES, SLOTS: G.SLOTS, RAR: G.RAR });
        if (sum && (sum.kills || sum.risk)) J(ws, { t: 'offline', sum, max: OFF_MAX / 3600 });
        sys(`${o.name} entrou no mundo.`);
        push(o);
      } catch (e) { J(ws, { t: 'err', x: 'Sessão inválida. Entre novamente.' }); ws.close(); }
      return;
    }
    act(o, m);
  });
  ws.on('close', () => {
    if (o && online.get(o.id) === o) { online.delete(o.id); save(o); }
  });
});

// tick de 1s: combate automático de todos os jogadores online (autoridade do servidor)
setInterval(() => {
  const now = Date.now();
  if (boss.hp <= 0 && now >= boss.respawnAt) { boss.hp = G.BOSS.hp; boss.dmg.clear(); sys(`${G.BOSS.n} reapareceu!`); }
  for (const o of online.values()) {
    let ev = {};
    if (o.c.auto) { ev = G.fight(o.c, 1); if (ev.died) ev.msg = 'Você foi derrotado e reviveu.'; }
    push(o, ev);
    if (++o.tick % 30 === 0) save(o);
  }
}, 1000);

async function shutdown() { await Promise.all([...online.values()].map(save)); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

db.init().then(() => server.listen(process.env.PORT || 3000, () => console.log('Eternal Legends no ar.')))
  .catch((e) => { console.error(e); process.exit(1); });

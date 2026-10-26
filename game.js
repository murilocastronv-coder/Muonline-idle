'use strict';
// Regras do jogo. Tudo aqui roda SOMENTE no servidor.
const R = Math.random;
const CLASSES = {
  dk: { n: 'Dark Knight', hp: 120, atk: 10, def: 5 },
  dw: { n: 'Dark Wizard', hp: 85, atk: 15, def: 2 },
};
const MON = [
  { n: 'Goblin', lv: 1, hp: 30, atk: 4, def: 0, xp: 8, g: 5, col: 0x55aa33, sz: 0.7 },
  { n: 'Lobo Sombrio', lv: 5, hp: 120, atk: 12, def: 3, xp: 30, g: 14, col: 0x555566, sz: 0.85 },
  { n: 'Esqueleto', lv: 10, hp: 400, atk: 26, def: 8, xp: 90, g: 35, col: 0xddddcc, sz: 1 },
  { n: 'Orc Guerreiro', lv: 16, hp: 1100, atk: 50, def: 16, xp: 250, g: 90, col: 0x887722, sz: 1.2 },
  { n: 'Golem de Pedra', lv: 24, hp: 3000, atk: 95, def: 35, xp: 700, g: 220, col: 0x777788, sz: 1.5 },
];
const BOSS = { n: 'Rei Esqueleto', lv: 15, hp: 30000, col: 0xffcc00, sz: 2.4, respawn: 300 };
const SLOTS = { weapon: 'Lâmina', helmet: 'Elmo', armor: 'Armadura', boots: 'Botas', ring: 'Anel' };
const RAR = ['Comum', 'Incomum', 'Raro', 'Épico', 'Lendário', 'Mítico'];
const MAXINV = 60;
const SKILLS = {
  dk: [
    {id:'slash',n:'Energy Slash',lv:1,dmg:1.5,color:'#ffd56b',type:'wave'},
    {id:'spin',n:'Whirlwind',lv:5,dmg:2.0,color:'#ff914d',type:'spin'},
    {id:'flameblade',n:'Flame Blade',lv:10,dmg:2.5,color:'#ff572e',type:'fire'},
    {id:'froststrike',n:'Frost Strike',lv:15,dmg:2.9,color:'#79e8ff',type:'ice'},
    {id:'shockwave',n:'Shockwave',lv:20,dmg:3.3,color:'#ffe8a1',type:'wave'},
    {id:'dragon',n:'Dragon Slash',lv:25,dmg:3.8,color:'#ff3d23',type:'fire'},
    {id:'storm',n:'Storm Blade',lv:30,dmg:4.3,color:'#83dfff',type:'lightning'},
    {id:'inferno',n:'Inferno',lv:35,dmg:5.0,color:'#ff752b',type:'meteor'}
  ],
  dw: [
    {id:'energy',n:'Energy Ball',lv:1,dmg:1.6,color:'#8be9ff',type:'arcane'},
    {id:'fire',n:'Fireball',lv:5,dmg:2.2,color:'#ff572e',type:'fire'},
    {id:'ice',n:'Ice Bolt',lv:10,dmg:2.6,color:'#7cecff',type:'ice'},
    {id:'lightning',n:'Lightning Bolt',lv:15,dmg:3.0,color:'#fff27a',type:'lightning'},
    {id:'meteor',n:'Meteor Shower',lv:20,dmg:3.5,color:'#ff7438',type:'meteor'},
    {id:'arcane',n:'Arcane Orb',lv:25,dmg:4.0,color:'#bf7bff',type:'arcane'},
    {id:'blizzard',n:'Blizzard',lv:30,dmg:4.5,color:'#7bcaff',type:'ice'},
    {id:'comet',n:'Comet of Chaos',lv:35,dmg:5.2,color:'#ff4dca',type:'meteor'}
  ]
};
function skillsFor(c){return (SKILLS[c.cls]||SKILLS.dk).map(s=>({...s,unlocked:c.lvl>=s.lv}));}

const xpNext = (l) => Math.floor(40 * Math.pow(l, 1.8));
const upCost = (lv) => Math.floor(50 * Math.pow(1.35, lv));
const uid = () => R().toString(36).slice(2, 10) + R().toString(36).slice(2, 6);

function newChar(cls) {
  return { cls, lvl: 1, xp: 0, gold: 0, inv: [], eq: {}, up: { dmg: 0, def: 0, spd: 0, xp: 0 },
    mon: 0, auto: true, kills: 0, bossKills: 0, hp: null, mhp: null };
}

function stats(c) {
  const b = CLASSES[c.cls];
  let atk = b.atk + c.lvl * 3, def = b.def + c.lvl * 1.5, hp = b.hp + c.lvl * 15;
  for (const s in c.eq) {
    const i = c.eq[s]; if (!i) continue;
    const m = 1 + i.plus * 0.12;
    atk += i.atk * m; def += i.def * m; hp += i.hp * m;
  }
  atk *= 1 + c.up.dmg * 0.05; def *= 1 + c.up.def * 0.05;
  return { atk: Math.floor(atk), def: Math.floor(def), hp: Math.floor(hp),
    spd: +(1 + c.up.spd * 0.04).toFixed(2), xpm: +(1 + c.up.xp * 0.05).toFixed(2) };
}

function addXp(c, x) {
  c.xp += x; let up = 0;
  while (c.xp >= xpNext(c.lvl)) { c.xp -= xpNext(c.lvl); c.lvl++; up++; }
  return up;
}

// ---------- itens ----------
function rarRoll(bonus = 1) {
  const r = R() / bonus;
  return r < 0.0005 ? 5 : r < 0.004 ? 4 : r < 0.03 ? 3 : r < 0.12 ? 2 : r < 0.35 ? 1 : 0;
}
function mkItem(lv, bonus = 1, min = 0) {
  const rar = Math.max(min, rarRoll(bonus));
  const slot = Object.keys(SLOTS)[Math.floor(R() * 5)];
  const p = (2 + lv * 1.2) * (1 + rar * 0.6) * (0.8 + R() * 0.4);
  let atk = 0, def = 0, hp = 0;
  if (slot === 'weapon') atk = p * 1.5;
  else if (slot === 'ring') { atk = p * 0.6; hp = p * 4; }
  else { def = p * 0.8; hp = p * 5; }
  return { id: uid(), slot, rar, lv, atk: Math.round(atk), def: Math.round(def), hp: Math.round(hp), plus: 0 };
}
const score = (i) => (i.atk * 1.5 + i.def + i.hp * 0.1) * (1 + i.plus * 0.12);
const enhCost = (i) => Math.floor(60 * Math.pow(i.plus + 1, 2) * (i.rar + 1));
const sell = (i) => Math.floor((5 + i.lv * 2) * Math.pow(i.rar + 1, 2) * (1 + i.plus));

function give(c, it, ev) {
  if (c.inv.length >= MAXINV) { const v = sell(it); c.gold += v; ev.gold = (ev.gold || 0) + v; }
  else { c.inv.push(it); ev.items.push(it); }
}
function autoEquip(c) {
  let n = 0;
  for (const sl in SLOTS) {
    const cur = c.eq[sl]; let best = cur;
    for (const i of c.inv) if (i.slot === sl && (!best || score(i) > score(best))) best = i;
    if (best && best !== cur) {
      c.inv = c.inv.filter((i) => i !== best);
      if (cur) c.inv.push(cur);
      c.eq[sl] = best; n++;
    }
  }
  return n;
}
function enhance(c, it) {
  if (it.plus >= 9) return 'Já está no máximo (+9).';
  const cost = enhCost(it);
  if (c.gold < cost) return 'Ouro insuficiente.';
  c.gold -= cost;
  if (R() < Math.max(0.25, 1 - it.plus * 0.1)) { it.plus++; return 'Aprimoramento bem-sucedido! +' + it.plus; }
  if (it.plus >= 6) { it.plus--; return 'Falhou! O item perdeu 1 nível.'; }
  return 'Falhou. Ouro perdido.';
}

// ---------- combate ----------
function kill(c, m, s, ev) {
  const xp = Math.floor(m.xp * s.xpm), g = Math.floor(m.g * (0.8 + R() * 0.4));
  ev.xp += xp; ev.gold += g; ev.kills++; c.kills++; c.gold += g;
  ev.lv += addXp(c, xp);
  if (R() < 0.15) give(c, mkItem(m.lv), ev);
}
function fight(c, dt, skill = null) {
  const m = MON[c.mon], s = stats(c);
  const ev = { xp: 0, gold: 0, items: [], kills: 0, died: false, lv: 0 }; if(skill) ev.skill={id:skill.id,n:skill.n,color:skill.color,type:skill.type||'arcane',dmg:Math.floor(s.atk*skill.dmg)};
  if (c.hp == null || c.hp > s.hp) c.hp = s.hp;
  if (c.mhp == null) c.mhp = m.hp;
  c.mhp -= Math.max(1, s.atk - m.def / 2) * s.spd * dt + (skill ? Math.max(1, Math.floor(s.atk * skill.dmg)) : 0);
  c.hp = Math.min(s.hp, c.hp + s.hp * 0.01 * dt) - Math.max(0, m.atk - s.def * 0.5) * 0.7 * dt;
  if (c.hp <= 0) { c.hp = s.hp; c.mhp = m.hp; ev.died = true; return ev; }
  if (c.mhp <= 0) { kill(c, m, s, ev); c.mhp = m.hp; }
  return ev;
}
// Recompensa offline: 50% de eficiência; não rende se o monstro é perigoso demais.
function offline(c, secs) {
  const m = MON[c.mon], s = stats(c);
  const ttk = m.hp / (Math.max(1, s.atk - m.def / 2) * s.spd);
  const risk = Math.max(0, m.atk - s.def * 0.5) * 0.7 * ttk > s.hp;
  const kills = risk ? 0 : Math.floor((secs / ttk) * 0.5);
  const ev = { xp: 0, gold: 0, items: [], kills: 0, lv: 0, secs: Math.floor(secs), mon: m.n, risk };
  if (!kills) return ev;
  ev.kills = kills; ev.xp = Math.floor(kills * m.xp * s.xpm); ev.gold = Math.floor(kills * m.g);
  c.gold += ev.gold; c.kills += kills; ev.lv = addXp(c, ev.xp);
  const n = Math.min(40, Math.round(kills * 0.12));
  for (let i = 0; i < n; i++) give(c, mkItem(m.lv), ev);
  return ev;
}

module.exports = { CLASSES, MON, BOSS, SLOTS, RAR, MAXINV, SKILLS, skillsFor, xpNext, upCost, newChar, stats, addXp, mkItem,
  give, autoEquip, enhance, enhCost, sell, fight, offline };

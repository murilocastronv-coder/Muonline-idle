# Eternal Legends: Idle MMORPG (versão 0.1)

Node.js + Express + WebSocket (ws) + PostgreSQL + Three.js. O servidor é autoritativo:
combate, XP, ouro, drops, itens e recompensas offline são calculados só no servidor.

## Páginas
- `/` página inicial (cadastro, login, contas e online ao vivo)
- `/jogo.html` o jogo


    npm install
    npm start          # http://localhost:3000
Sem `DATABASE_URL` os dados ficam em memória (somem ao reiniciar). Com Postgres local:
`DATABASE_URL=postgres://user:senha@localhost:5432/eternal PGSSL=off npm start`

## Deploy na Render
1. Suba esta pasta para um repositório no GitHub.
2. Na Render: New > Blueprint > escolha o repositório. O `render.yaml` cria o web service e o PostgreSQL.
3. Aguarde o deploy e abra a URL `https://eternal-legends.onrender.com` (ou a que a Render mostrar).
Sem Blueprint: crie um PostgreSQL, depois um Web Service (Build: `npm install`, Start: `node server.js`) com as variáveis
`DATABASE_URL` (Internal Database URL), `JWT_SECRET` (texto longo e aleatório) e `OFFLINE_MAX_HOURS` (padrão 8).

## Já funciona
Contas e login (bcrypt + JWT), 2 classes, 5 monstros, 1 chefe mundial compartilhado, combate automático,
recompensas offline com limite configurável, itens com 6 raridades, aprimoramento, equipar melhores itens,
melhorias com ouro, chat global, ranking, lista de online, jogadores reais vistos no mesmo mundo.

## Próximos passos
Mercado, amigos, grupos, guildas, PvP, missões, outros mapas/classes, loja cosmética.

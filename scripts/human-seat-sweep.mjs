// Human-seat sweep for the solo games, through the real @zekel/mcp server
// (examples/serve.mjs): create a HUMAN session and loop — next_step must be a
// human directive with a human_response, get_legal_moves must offer something,
// suggest_move must be accepted by apply_move, and the player view and the
// summaries must never carry hidden fields. Also exercises get_rules and the
// game's lore tool. Build first:  pnpm build && node scripts/human-seat-sweep.mjs [game-id] [seeds...]
//
// This is the repo-local stand-in for the engine repo's
// scripts/human-seat-sweep.ts (post-port runbook §7), which needs the game
// registered on that server.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAMES = {
  '8-bit-demon-hunter': { lore: 'get_demon_hunter_lore', loreTopic: 'Memlax and Chineera', hidden: /isDemon|isMinion|demonId|"answers"/, guidance: 'NEVER GIVE HINTS', rulesWords: ['Combat', 'The finale'] },
  'warble-way-galaxy': { lore: 'get_lore', loreTopic: 'Xaxalon 4', hidden: /\bNEVER_LEAKS\b/, guidance: 'DM CONTRACT', rulesWords: ['CHECKS'] },
};

const gameId = process.argv[2] ?? '8-bit-demon-hunter';
const seeds = process.argv.slice(3).map(Number).filter((n) => Number.isFinite(n));
const cfg = GAMES[gameId];
if (!cfg) {
  console.error(`Unknown solo game ${gameId}; known: ${Object.keys(GAMES).join(', ')}`);
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('node', [resolve(root, 'examples/serve.mjs')], { env: { ...process.env, SESSION_STORE: 'memory' }, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const waiting = new Map();
let nextId = 0;
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  }
});
const rpc = (method, params) =>
  new Promise((done) => {
    const id = ++nextId;
    waiting.set(id, done);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
async function tool(name, args) {
  const res = (await rpc('tools/call', { name, arguments: args })).result;
  let body;
  try {
    body = JSON.parse(res.content[0].text);
  } catch {
    body = res.content[0].text;
  }
  return { isError: !!res.isError, body };
}
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok' : 'FAILED'} - ${what}`);
  if (!ok) failed++;
};

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sweep', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
check(tools.includes(cfg.lore), `${cfg.lore} registered (${tools.length} tools)`);

const rules = await tool('get_rules', { game_id: gameId });
const rulesText = JSON.stringify(rules.body);
check(!rules.isError && cfg.rulesWords.every((w) => rulesText.includes(w)), `get_rules serves the rules (${rulesText.length} chars)`);

const lore = await tool(cfg.lore, {});
check(!lore.isError && (lore.body.topics?.length ?? 0) >= 5, `lore index lists ${lore.body.topics?.length} topics`);
const topic = await tool(cfg.lore, { topic: cfg.loreTopic });
check(!topic.isError && String(topic.body.lore ?? '').length > 50, `lore topic by title ("${cfg.loreTopic}")`);

for (const seed of seeds.length > 0 ? seeds : [5, 6, 7]) {
  const created = await tool('create_session', { game_id: gameId, players: [{ player_id: 'p1', kind: 'human', name: 'Zeke' }], options: { seed } });
  check(!created.isError, `seed ${seed}: create_session`);
  if (created.isError) {
    console.log(JSON.stringify(created.body).slice(0, 300));
    continue;
  }
  const sid = created.body.session_id;
  check(JSON.stringify(created.body).includes(cfg.guidance), `seed ${seed}: session-start guidance carries "${cfg.guidance}"`);
  let step = created.body.next_step;
  let moves = 0;
  let bad = 0;
  let over = false;
  while (moves < 300 && !over) {
    if (step?.status !== 'human_to_move' || !step.human_response?.ask) {
      bad++;
      console.log('  bad step', JSON.stringify(step).slice(0, 200));
      break;
    }
    const legal = await tool('get_legal_moves', { session_id: sid, player_id: 'p1' });
    const list = legal.body.legal_moves ?? legal.body.moves ?? legal.body;
    if (!Array.isArray(list) || list.length === 0) {
      bad++;
      console.log('  nothing offered', JSON.stringify(legal.body).slice(0, 200));
      break;
    }
    const state = await tool('get_state', { session_id: sid, player_id: 'p1' });
    if (cfg.hidden.test(JSON.stringify(state.body))) {
      bad++;
      console.log('  HIDDEN FIELD LEAKED');
      break;
    }
    const sug = await tool('suggest_move', { session_id: sid, player_id: 'p1' });
    const move = sug.body.suggested_move?.type ? sug.body.suggested_move : (sug.body.suggested_move?.move ?? sug.body.move);
    if (!move) {
      bad++;
      console.log('  no suggestion', JSON.stringify(sug.body).slice(0, 300));
      break;
    }
    const applied = await tool('apply_move', { session_id: sid, player_id: 'p1', move });
    if (applied.isError) {
      bad++;
      console.log('  suggestion refused', JSON.stringify(move), JSON.stringify(applied.body).slice(0, 300));
      break;
    }
    if (cfg.hidden.test(applied.body.state_summary ?? '')) {
      bad++;
      console.log('  summary leak');
      break;
    }
    step = applied.body.next_step;
    moves++;
    if (step?.status === 'game_over') over = true;
  }
  check(bad === 0, `seed ${seed}: ${moves} human-seat moves via suggest_move, every step a human directive, no leaks${over ? ', reached game over' : ''}`);
}

console.log(failed ? 'SWEEP FAILED' : 'SWEEP OK');
child.kill();
process.exit(failed ? 1 : 0);

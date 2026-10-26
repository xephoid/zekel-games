// End-to-end check: start examples/serve.mjs (the real @zekel/mcp server with
// all eight games) and, through the MCP tools, play an easy all-AI game of each
// to the end, read Warble Way Galaxy's lore, and check a human seat is asked
// for its setup. Build first:  pnpm build && pnpm smoke

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('node', [resolve(root, 'examples/serve.mjs')], {
  env: { ...process.env, SESSION_STORE: 'memory', MCTS_BUDGET_MS: '50' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
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
  return { isError: !!res.isError, body: JSON.parse(res.content[0].text) };
}
let failed = false;
function check(ok, what) {
  console.log(`${ok ? 'ok' : 'FAILED'} - ${what}`);
  if (!ok) failed = true;
}

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const listed = (await tool('list_games', {})).body;
const ids = (listed.games ?? listed).map((g) => g.game_id ?? g.id).sort();
const expected = ['8-bit-demon-hunter', 'adventurer-olympics', 'cybernoir-2127', 'fractured-fist', 'neither-guts-nor-gears', 'sweetlands-imperium', 'warble-way-galaxy', 'word-debauchee'];
check(JSON.stringify(ids) === JSON.stringify(expected), `list_games shows the eight games (${ids.join(', ')})`);

for (const game_id of expected) {
  const players =
    game_id === 'warble-way-galaxy' || game_id === '8-bit-demon-hunter'
      ? [{ player_id: 'p1', kind: 'ai', difficulty: 'easy' }]
      : [{ player_id: 'p1', kind: 'ai', difficulty: 'easy' }, { player_id: 'p2', kind: 'ai', difficulty: 'easy' }];
  const created = await tool('create_session', { game_id, players, options: { seed: 11 } });
  if (created.isError) { check(false, `${game_id}: create_session (${JSON.stringify(created.body).slice(0, 160)})`); continue; }
  const sid = created.body.session_id;
  let moves = 0;
  let status = created.body.next_step?.status;
  for (let i = 0; i < 40 && status === 'ai_to_move'; i++) {
    const turn = await tool('run_ai_turn', { session_id: sid, player_id: created.body.next_step.active_player_id ?? 'p1' });
    if (turn.isError) { check(false, `${game_id}: run_ai_turn (${JSON.stringify(turn.body).slice(0, 200)})`); break; }
    moves += turn.body.moves?.length ?? 0;
    status = turn.body.next_step?.status;
  }
  const over = await tool('is_game_over', { session_id: sid });
  check(!over.isError && over.body.game_over === true, `${game_id}: all-AI game played to the end in ${moves} moves (${String(over.body.summary ?? '').slice(0, 70)})`);
}

const lore = await tool('get_lore', {});
check(!lore.isError && lore.body.topics?.length >= 5, `get_lore lists ${lore.body.topics?.length} Warble Way Galaxy topics`);

for (const game_id of ['fractured-fist', 'sweetlands-imperium', 'cybernoir-2127', 'neither-guts-nor-gears', 'adventurer-olympics', 'word-debauchee']) {
  const created = await tool('create_session', {
    game_id,
    players: [{ player_id: 'p1', kind: 'human', name: 'Zeke' }, { player_id: 'p2', kind: 'ai', difficulty: 'easy' }],
    options: { seed: 5 },
  });
  const step = created.body.next_step ?? {};
  check(!created.isError && typeof step.status === 'string', `${game_id}: a human seat gets a directive (${step.status}, ${String(step.instruction ?? '').slice(0, 50)}…)`);
}

{
  const created = await tool('create_session', {
    game_id: '8-bit-demon-hunter',
    players: [{ player_id: 'p1', kind: 'human', name: 'Zeke' }],
    options: { seed: 5 },
  });
  const step = created.body.next_step ?? {};
  check(!created.isError && step.status === 'human_to_move', `8-bit-demon-hunter: a human seat gets a directive (${step.status}, ${String(step.instruction ?? '').slice(0, 50)}…)`);
  const lore = await tool('get_demon_hunter_lore', {});
  check(!lore.isError && lore.body.topics?.length >= 5, `get_demon_hunter_lore lists ${lore.body.topics?.length} 8-bit Demon Hunter topics`);
}

console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
child.kill();
process.exit(failed ? 1 : 0);

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtraResources, ExtraTool } from '@zekel/game-kit';

// The Warble Way Galaxy lore repository: read-only, user-curated markdown, one
// topic per file, seeded from the designer's Story book. The DM (the LLM
// client) pulls topics to ground its narration — the game's session-start
// guidance tells it to FETCH lore rather than invent setting detail.
// Added to the server through Game.getExtraTools / getExtraResources (index.ts);
// the server builds the real MCP tool and resources (src/mcp/extensions.ts).
//
// Files live in ./lore/*.md with minimal frontmatter (title / summary /
// optional tags). The relative path below resolves the same under src/ (tsx
// dev) and dist/ (compiled) — scripts/copy-lore.mjs copies the .md files into
// dist at build time.

export interface LoreTopic {
  topic_id: string;
  title: string;
  summary: string;
  tags: string[];
  body: string;
}

const LORE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'lore');

// Frontmatter is deliberately minimal (title/summary/tags) — a hand-rolled
// parser keeps the repo dependency-free. Unknown keys are ignored.
function parseLoreFile(topicId: string, raw: string): LoreTopic {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(
      `Lore file ${topicId}.md is missing its frontmatter block (--- title/summary ---).`,
    );
  }
  const head = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const fields = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields.set(kv[1]!.toLowerCase(), kv[2]!.trim());
  }
  const title = fields.get('title');
  const summary = fields.get('summary');
  if (!title || !summary) {
    throw new Error(`Lore file ${topicId}.md frontmatter needs both title: and summary:.`);
  }
  const tags = (fields.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return { topic_id: topicId, title, summary, tags, body };
}

export function loadLoreTopics(dir: string = LORE_DIR): LoreTopic[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseLoreFile(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')));
}

// Case / spacing / punctuation-tolerant lookup — the "accept the printed name"
// rule applied to lore: the DM may ask for "Xaxalon 4", "xaxalon-4", or the
// topic's title verbatim.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveLoreTopic(topics: LoreTopic[], requested: string): LoreTopic | null {
  const want = normalize(requested);
  return (
    topics.find((t) => normalize(t.topic_id) === want) ??
    topics.find((t) => normalize(t.title) === want) ??
    null
  );
}

function loreIndex(topics: LoreTopic[]) {
  return {
    game_id: 'warble-way-galaxy',
    topics: topics.map(({ topic_id, title, summary, tags }) => ({
      topic_id,
      title,
      summary,
      ...(tags.length > 0 ? { tags } : {}),
    })),
    how_to_use:
      'Call get_lore with a topic (topic_id or title) to fetch the full entry. ' +
      'Ground your narration in these entries — never invent setting facts that ' +
      'contradict them, and if a subject has no topic, keep your color generic.',
  };
}

// Loaded once on first use; lore is read-only at runtime (user-curated files,
// re-read on process restart).
let cachedTopics: LoreTopic[] | null = null;
function topics(): LoreTopic[] {
  cachedTopics ??= loadLoreTopics();
  return cachedTopics;
}

export function loreTools(): ExtraTool[] {
  return [
    {
      name: 'get_lore',
      description:
        'The Warble Way Galaxy lore repository — setting facts for the DM to ground ' +
        'narration in (races, factions, organizations, places, the ancient ruins). ' +
        'Call with no arguments for the topic index; call with a topic (topic_id or ' +
        'title, spelling-tolerant) for the full entry. Fetch the relevant topic BEFORE ' +
        'narrating a race, faction, place, or NPC for the first time. Lore is canon: ' +
        'never contradict it, and never invent facts a topic would cover. (Applies ' +
        'only to Warble Way Galaxy sessions; other games have no lore repository.)',
      args: {
        topic: { optional: true, description: 'topic_id or title from the index; omit to list all topics' },
      },
      run(args) {
        const all = topics();
        if (!args.topic) return { result: loreIndex(all) };
        const hit = resolveLoreTopic(all, args.topic);
        if (!hit) {
          return {
            error: {
              error_code: 'LORE_TOPIC_NOT_FOUND',
              message: `No lore topic matches "${args.topic}". Valid topics: ${all.map((t) => t.topic_id).join(', ')}.`,
            },
          };
        }
        return {
          result: {
            topic_id: hit.topic_id,
            title: hit.title,
            summary: hit.summary,
            ...(hit.tags.length > 0 ? { tags: hit.tags } : {}),
            lore: hit.body,
          },
        };
      },
    },
  ];
}

export function loreResources(): ExtraResources {
  return {
    fixed: [
      {
        name: 'lore-index',
        uri: 'game://warble-way-galaxy/lore',
        title: 'Warble Way Galaxy lore index',
        description: 'Index of every lore topic (id, title, summary, tags).',
        mimeType: 'application/json',
        read: () => JSON.stringify(loreIndex(topics()), null, 2),
      },
    ],
    templates: [
      {
        name: 'lore-topic',
        uriTemplate: 'game://warble-way-galaxy/lore/{topic}',
        title: 'Warble Way Galaxy lore topic',
        description: 'Full markdown for one lore topic.',
        mimeType: 'text/markdown',
        read(vars) {
          const hit = resolveLoreTopic(topics(), String(vars.topic));
          if (!hit) {
            throw new Error(
              `No lore topic matches "${String(vars.topic)}". Read game://warble-way-galaxy/lore for the index.`,
            );
          }
          return `# ${hit.title}\n\n${hit.body}\n`;
        },
      },
    ],
  };
}

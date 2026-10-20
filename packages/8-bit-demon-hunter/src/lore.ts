// The lore repository: read-only markdown, one topic per file in ./lore,
// drawn from the original's loreRegistry (what townsfolk say). The GM pulls
// topics to ground its narration. The same minimal frontmatter and loader as
// Warble Way Galaxy's lore.ts; copy-assets.mjs copies the .md files to dist.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LoreTopic {
  topic_id: string;
  title: string;
  summary: string;
  tags: string[];
  body: string;
}

const LORE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'lore');

function parseLoreFile(topicId: string, raw: string): LoreTopic {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Lore file ${topicId}.md is missing its frontmatter block.`);
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields.set(kv[1]!.toLowerCase(), kv[2]!.trim());
  }
  const title = fields.get('title');
  const summary = fields.get('summary');
  if (!title || !summary) throw new Error(`Lore file ${topicId}.md frontmatter needs title: and summary:.`);
  const tags = (fields.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return { topic_id: topicId, title, summary, tags, body: (match[2] ?? '').trim() };
}

export function loadLoreTopics(dir: string = LORE_DIR): LoreTopic[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseLoreFile(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')));
}

export function loreIndex(topics: LoreTopic[]): { topics: { topic_id: string; title: string; summary: string; tags: string[] }[] } {
  return { topics: topics.map(({ topic_id, title, summary, tags }) => ({ topic_id, title, summary, tags })) };
}

export function loreTopic(topics: LoreTopic[], topicId: string): LoreTopic | null {
  return topics.find((t) => t.topic_id === topicId) ?? null;
}

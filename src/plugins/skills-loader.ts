/**
 * Skills Loader
 *
 * Discovers and parses SKILL.md files with YAML frontmatter.
 * Compatible with OpenClaw's skill format.
 * Dirs are ordered by precedence — first-discovered wins on name conflicts.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

export interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  commandDispatch?: string;
  commandTool?: string;
  commandArgMode?: string;
  metadata?: {
    agid?: { requiresWallet?: boolean; auditable?: boolean; category?: string };
    openclaw?: { requires?: { bins?: string[]; env?: string[] } };
  };
  body: string;
  filePath: string;
}

/**
 * Parse a SKILL.md file with YAML frontmatter.
 */
export async function parseSkillFile(filePath: string): Promise<Skill | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatterStr, body] = match;

  let frontmatter: Record<string, any>;
  try {
    frontmatter = parseYaml(frontmatterStr);
  } catch {
    console.warn(`[SkillsLoader] Invalid YAML in ${filePath} — skipping`);
    return null;
  }

  if (!frontmatter.name || !frontmatter.description) {
    console.warn(`[SkillsLoader] Skill at ${filePath} missing name or description — skipping`);
    return null;
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    userInvocable: frontmatter['user-invocable'] !== false,
    disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    commandDispatch: frontmatter['command-dispatch'],
    commandTool: frontmatter['command-tool'],
    commandArgMode: frontmatter['command-arg-mode'],
    metadata: frontmatter.metadata,
    body: body.trim(),
    filePath,
  };
}

/**
 * Discover skills from a list of directories.
 * Dirs are ordered by precedence (highest first) — first-discovered wins.
 */
export async function discoverSkills(dirs: string[]): Promise<Skill[]> {
  const seen = new Map<string, Skill>();

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      try {
        const s = await stat(entryPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillPath = join(entryPath, 'SKILL.md');
      const skill = await parseSkillFile(skillPath);
      if (skill && !seen.has(skill.name)) {
        seen.set(skill.name, skill);
      }
    }
  }

  return [...seen.values()];
}

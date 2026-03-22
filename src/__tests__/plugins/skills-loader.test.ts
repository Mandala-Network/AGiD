import { describe, it, expect } from 'vitest';
import { parseSkillFile, discoverSkills } from '../../plugins/skills-loader.js';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseSkillFile', () => {
  it('parses SKILL.md with YAML frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: test-skill
description: A test skill
user-invocable: true
---

Instructions for the agent.
`);
    const skill = await parseSkillFile(skillPath);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('test-skill');
    expect(skill!.description).toBe('A test skill');
    expect(skill!.userInvocable).toBe(true);
    expect(skill!.body).toContain('Instructions for the agent.');
  });

  it('defaults user-invocable to true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: minimal
description: Minimal skill
---

Body.
`);
    const skill = await parseSkillFile(skillPath);
    expect(skill!.userInvocable).toBe(true);
  });

  it('parses agid metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: wallet-skill
description: Needs wallet
metadata:
  agid:
    requiresWallet: true
    auditable: true
---

Body.
`);
    const skill = await parseSkillFile(skillPath);
    expect(skill!.metadata?.agid?.requiresWallet).toBe(true);
    expect(skill!.metadata?.agid?.auditable).toBe(true);
  });

  it('returns null for files without frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, 'Just plain text, no frontmatter.');
    const skill = await parseSkillFile(skillPath);
    expect(skill).toBeNull();
  });
});

describe('discoverSkills', () => {
  it('discovers SKILL.md files in subdirectories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skills-'));
    const skillDir = join(dir, 'my-skill');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: discovered
description: Found it
---

Body.
`);
    const skills = await discoverSkills([dir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('discovered');
  });

  it('deduplicates by skill name (first wins)', async () => {
    const dir1 = await mkdtemp(join(tmpdir(), 'skills1-'));
    const dir2 = await mkdtemp(join(tmpdir(), 'skills2-'));

    const skill1 = join(dir1, 'my-skill');
    await mkdir(skill1);
    await writeFile(join(skill1, 'SKILL.md'), `---
name: shared
description: From dir1
---
Body1.
`);

    const skill2 = join(dir2, 'my-skill');
    await mkdir(skill2);
    await writeFile(join(skill2, 'SKILL.md'), `---
name: shared
description: From dir2
---
Body2.
`);

    // dir1 has higher precedence (listed first)
    const skills = await discoverSkills([dir1, dir2]);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('From dir1');
  });
});

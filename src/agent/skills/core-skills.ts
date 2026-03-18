/**
 * Core Skills Bootstrap
 *
 * Hand-authored foundational skills that teach the agent to compose tools
 * for common cryptographic and messaging tasks.
 *
 * seedCoreSkills() checks on-chain state and creates any missing core skills.
 * Designed to be called during gateway startup — failures log but don't crash.
 */

import type { SkillDescriptor } from './types.js';
import type { SkillStore } from './skill-store.js';

export const CORE_SKILLS: SkillDescriptor[] = [];

/**
 * Seed core skills on-chain if they don't already exist.
 * Safe to call on every startup — idempotent by name matching.
 */
export async function seedCoreSkills(skillStore: SkillStore): Promise<void> {
  try {
    const existing = await skillStore.fetchAll();
    const existingNames = new Set(existing.map((s) => s.name));

    let seeded = 0;
    let skipped = 0;

    for (const skill of CORE_SKILLS) {
      if (existingNames.has(skill.name)) {
        skipped++;
        continue;
      }

      try {
        await skillStore.store(skill);
        console.log(`[core-skills] Seeded: ${skill.name}`);
        seeded++;
      } catch (error) {
        console.error(
          `[core-skills] Failed to seed "${skill.name}":`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(
      `[core-skills] Seeded ${seeded} of ${CORE_SKILLS.length} core skills (${skipped} already existed)`,
    );
  } catch (error) {
    console.error(
      '[core-skills] Seeding failed (non-fatal):',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Skill Creator Tool
 *
 * Allows the agent to self-author skills: compose tool recipes,
 * optionally optimize via GEPA, store on-chain, and hot-load immediately.
 */

import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';
import type { SkillDescriptor } from '../skills/types.js';

export function skillCreatorTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_create_skill',
        description: 'Create a new skill — a reusable recipe that teaches the agent how to compose tools for a specific task. The skill is GEPA-optimized (if available), stored on-chain as a PushDrop token in the agidskills basket, and hot-loaded immediately (no restart needed). Returns the txid and UHRP URL.',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Unique skill name (lowercase, hyphen-separated, e.g. "authorship-proof")',
            },
            description: {
              type: 'string',
              description: 'One-line description of when to use this skill',
            },
            triggers: {
              type: 'string',
              description: 'Comma-separated trigger keywords/phrases that activate this skill (e.g. "prove authorship,content proof,timestamp")',
            },
            tools: {
              type: 'string',
              description: 'Comma-separated tool names this skill composes (e.g. "agid_sign,agid_store_memory")',
            },
            body: {
              type: 'string',
              description: 'Markdown body — the step-by-step recipe the agent should follow when this skill is activated',
            },
          },
          required: ['name', 'description', 'triggers', 'tools', 'body'],
        },
      },
      requiresWallet: true,
      category: 'skills',
      execute: async (params, ctx) => {
        const skillStore = ctx.skillStore;
        if (!skillStore) {
          throw new Error('SkillStore not configured — cannot create skills');
        }

        const name = params.name as string;
        const description = params.description as string;
        const triggers = (params.triggers as string).split(',').map(t => t.trim()).filter(Boolean);
        const requiredTools = (params.tools as string).split(',').map(t => t.trim()).filter(Boolean);
        let body = params.body as string;

        // GEPA-optimize the skill body if available
        const gepa = ctx.gepaOptimizer;
        if (gepa?.available) {
          try {
            body = await gepa.optimize(
              body,
              `Optimize this skill recipe for an autonomous AI agent. ` +
              `The skill is called "${name}" and composes these tools: [${requiredTools.join(', ')}]. ` +
              `Maximize instruction clarity, step ordering, and LLM comprehension. ` +
              `Preserve all technical details and tool parameters. ` +
              `Make each step actionable and unambiguous.`,
              { maxIterations: 5 },
            );
            console.log(`[SkillCreator] GEPA optimized skill body for "${name}"`);
          } catch (error) {
            console.warn(`[SkillCreator] GEPA optimization failed, using original body:`, error instanceof Error ? error.message : error);
          }
        }

        // Build skill descriptor
        const skill: SkillDescriptor = {
          name,
          description,
          triggers,
          requiredTools,
          body,
        };

        // Store on-chain
        const stored = await skillStore.store(skill);

        // Hot-load: add to live skills list (no restart needed)
        const promptBuilder = ctx.promptBuilder;
        if (promptBuilder) {
          const currentSkills = promptBuilder.getSkills();
          const updatedSkills = currentSkills.filter(s => s.name !== name);
          updatedSkills.push(stored);
          promptBuilder.setSkills(updatedSkills);
          console.log(`[SkillCreator] Hot-loaded skill "${name}" (total: ${updatedSkills.length})`);
        }

        return ok({
          created: true,
          name: stored.name,
          txid: stored.txid,
          uhrpUrl: stored.uhrpUrl,
          triggers: stored.triggers,
          requiredTools: stored.requiredTools,
          gepaOptimized: gepa?.available ?? false,
        });
      },
    },
  ];
}

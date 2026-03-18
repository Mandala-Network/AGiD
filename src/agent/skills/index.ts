/**
 * Skill System
 *
 * On-chain skill storage, retrieval, and prompt injection.
 * Skills are UHRP-hashed markdown files stored as PushDrop tokens
 * in the agidskills wallet basket.
 */

export type { SkillDescriptor } from './types.js';
export { SKILL_TOKEN_FIELDS, SKILL_BASKET, SKILL_PROTOCOL_ID } from './types.js';
export { SkillStore } from './skill-store.js';

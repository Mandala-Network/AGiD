/**
 * Skill Descriptor Types
 *
 * Skills are higher-level recipes that teach the agent HOW to compose tools
 * for specific tasks. Stored on-chain as UHRP-hashed markdown files with
 * metadata in PushDrop token fields.
 */

/**
 * A skill is a markdown recipe with metadata describing when and how to use it.
 */
export interface SkillDescriptor {
  /** Human-readable skill name */
  name: string;
  /** One-line description: when to use this skill */
  description: string;
  /** Keywords/phrases that activate this skill in prompt matching */
  triggers: string[];
  /** Tool names this skill composes */
  requiredTools: string[];
  /** Markdown body — the recipe the agent follows */
  body: string;
  /** PushDrop token transaction ID (set after on-chain storage) */
  txid?: string;
  /** UHRP content address (set after UHRP upload) */
  uhrpUrl?: string;
  /** Encryption key ID (from customInstructions, needed for UHRP body decryption) */
  keyID?: string;
}

/** PushDrop token field layout for agidskills basket */
export const SKILL_TOKEN_FIELDS = {
  UHRP_URL: 0,
  NAME: 1,
  DESCRIPTION: 2,
  TRIGGERS: 3,
  REQUIRED_TOOLS: 4,
} as const;

/** Wallet basket name for skill tokens */
export const SKILL_BASKET = 'agidskills';

/** Protocol ID for skill encryption and PushDrop signing */
export const SKILL_PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'agidentity skill'];

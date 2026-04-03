/**
 * Skill Store
 *
 * On-chain skill storage and retrieval using PushDrop tokens + UHRP.
 * Follows the memory-writer/reader pattern:
 *   encrypt → UHRP upload → PushDrop token → wallet basket
 *
 * Skill metadata lives in PushDrop token fields (fast to read, no UHRP fetch).
 * Skill body lives in UHRP-stored markdown (lazy-resolved when matched).
 * Local body cache prevents redundant UHRP fetches.
 */

import { PushDrop, LockingScript, StorageUploader, StorageDownloader } from '@bsv/sdk';
import type { SkillDescriptor } from './types.js';
import { SKILL_TOKEN_FIELDS, SKILL_BASKET, SKILL_PROTOCOL_ID } from './types.js';
import type { BRC100Wallet } from '../../types/index.js';

const UHRP_TIMEOUT_MS = 15_000;

export class SkillStore {
  /** Local body cache: skill name → resolved markdown body */
  private bodyCache = new Map<string, string>();

  constructor(
    private wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
    private storageUrl: string = 'https://go-uhrp.b1nary.cloud',
  ) {}

  // ===========================================================================
  // Store — UHRP upload + PushDrop token
  // ===========================================================================

  /**
   * Store a skill on-chain.
   *
   * 1. Compose skill markdown with YAML frontmatter
   * 2. Encrypt and upload to UHRP
   * 3. Create PushDrop token with metadata fields in agidskills basket
   */
  async store(skill: SkillDescriptor): Promise<SkillDescriptor> {
    const underlyingWallet = this.wallet.getUnderlyingWallet?.();
    if (!underlyingWallet) {
      throw new Error('Cannot access underlying wallet for skill storage');
    }

    const skillMd = this.composeSkillMd(skill);
    const keyId = `skill-${skill.name}-${Date.now()}`;

    // 1. Encrypt
    const plaintext = new TextEncoder().encode(skillMd);
    const encrypted = await this.wallet.encrypt({
      plaintext: Array.from(plaintext),
      protocolID: SKILL_PROTOCOL_ID,
      keyID: keyId,
    });

    // 2. UHRP upload (with timeout, fall back to embedded)
    let uhrpUrl = '';
    let embeddedData: number[] | null = null;

    try {
      const uploader = new StorageUploader({
        storageURL: this.storageUrl,
        wallet: underlyingWallet,
      });

      const uploadResult = await Promise.race([
        uploader.publishFile({
          file: {
            data: new Uint8Array(encrypted.ciphertext),
            type: 'application/octet-stream',
          },
          retentionPeriod: 365 * 24 * 60, // 1 year in minutes
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`UHRP upload timed out after ${UHRP_TIMEOUT_MS}ms`)), UHRP_TIMEOUT_MS),
        ),
      ]);

      uhrpUrl = uploadResult.uhrpURL;
      console.log(`[SkillStore] UHRP upload OK: ${uhrpUrl}`);
    } catch (error) {
      console.warn(`[SkillStore] UHRP upload failed, embedding in token: ${error instanceof Error ? error.message : error}`);
      embeddedData = Array.from(encrypted.ciphertext);
    }

    // 3. Build PushDrop token fields
    const fields: number[][] = [
      Array.from(new TextEncoder().encode(uhrpUrl || 'embedded')),
      Array.from(new TextEncoder().encode(skill.name)),
      Array.from(new TextEncoder().encode(skill.description)),
      Array.from(new TextEncoder().encode(skill.triggers.join(','))),
      Array.from(new TextEncoder().encode(skill.requiredTools.join(','))),
    ];

    // If UHRP failed, embed encrypted content as a 6th field
    if (embeddedData) {
      fields.push(embeddedData);
    }

    const pushDrop = new PushDrop(underlyingWallet);
    const lockingScript = await pushDrop.lock(
      fields,
      SKILL_PROTOCOL_ID,
      keyId,
      'self',
      true,   // forSelf
      true,   // includeSignature
    );

    // 4. Create transaction with token output
    const customInstr = JSON.stringify({ keyID: keyId });
    const result = await this.wallet.createAction({
      description: `Store skill: ${skill.name}`,
      outputs: [{
        script: lockingScript.toHex(),
        satoshis: 1,
        basket: SKILL_BASKET,
        tags: ['agidskill', skill.name],
        customInstructions: customInstr,
      }],
      labels: ['agidskill', skill.name],
    });

    if (!result.txid) {
      throw new Error('Skill store failed: no txid returned from createAction');
    }

    // Cache locally so we don't need to UHRP-fetch our own skills
    this.bodyCache.set(skill.name, skill.body);

    console.log(`[SkillStore] Stored skill "${skill.name}" (txid: ${result.txid})`);
    return {
      ...skill,
      txid: result.txid,
      uhrpUrl: uhrpUrl || `embedded:${result.txid}`,
    };
  }

  // ===========================================================================
  // Fetch All — metadata from on-chain basket (no UHRP fetch needed)
  // ===========================================================================

  /**
   * Fetch all skill descriptors from the agidskills basket.
   * Only reads PushDrop token metadata fields — bodies are NOT resolved here.
   * Use resolveBody() to lazy-load the body when a skill is matched.
   */
  async fetchAll(): Promise<SkillDescriptor[]> {
    const underlyingWallet = this.wallet.getUnderlyingWallet?.();
    if (!underlyingWallet) {
      throw new Error('Cannot access underlying wallet for skill retrieval');
    }

    const result = await underlyingWallet.listOutputs({
      basket: SKILL_BASKET,
      tags: ['agidskill'],
      include: 'locking scripts',
      includeCustomInstructions: true,
    });

    const skills: SkillDescriptor[] = [];

    for (const output of result.outputs) {
      try {
        if (!output.spendable || !output.lockingScript) continue;

        const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
        const fieldStrings = decoded.fields.map(
          (f: number[]) => new TextDecoder().decode(new Uint8Array(f)),
        );

        const name = fieldStrings[SKILL_TOKEN_FIELDS.NAME] ?? '';
        const txid = output.outpoint?.split(':')[0] ?? '';

        // Extract keyID from customInstructions (stored at write time)
        let keyID: string | undefined;
        if (output.customInstructions) {
          try {
            const instr = JSON.parse(output.customInstructions);
            keyID = instr.keyID;
          } catch {
            // ignore malformed customInstructions
          }
        }

        skills.push({
          name,
          description: fieldStrings[SKILL_TOKEN_FIELDS.DESCRIPTION] ?? '',
          triggers: (fieldStrings[SKILL_TOKEN_FIELDS.TRIGGERS] ?? '').split(',').filter(Boolean),
          requiredTools: (fieldStrings[SKILL_TOKEN_FIELDS.REQUIRED_TOOLS] ?? '').split(',').filter(Boolean),
          body: this.bodyCache.get(name) || '',
          txid,
          uhrpUrl: fieldStrings[SKILL_TOKEN_FIELDS.UHRP_URL] ?? '',
          keyID,
        });
      } catch (error) {
        console.warn('[SkillStore] Failed to decode skill token:', error instanceof Error ? error.message : error);
      }
    }

    console.log(`[SkillStore] Fetched ${skills.length} skills from on-chain basket`);
    return skills;
  }

  // ===========================================================================
  // Resolve Body — lazy UHRP download + decrypt (only when matched)
  // ===========================================================================

  /**
   * Resolve a skill's markdown body from UHRP or local cache.
   * Called only when a skill is matched by trigger keywords, not at startup.
   */
  async resolveBody(skill: SkillDescriptor): Promise<string> {
    // Already have the body
    if (skill.body) return skill.body;

    // Check local cache
    const cached = this.bodyCache.get(skill.name);
    if (cached) return cached;

    // No UHRP URL — nothing to resolve
    if (!skill.uhrpUrl || skill.uhrpUrl === 'embedded') return '';

    try {
      const network = await this.wallet.getNetwork();
      const downloader = new StorageDownloader({ networkPreset: network });

      const downloadResult = await Promise.race([
        downloader.download(skill.uhrpUrl),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`UHRP download timed out after ${UHRP_TIMEOUT_MS}ms`)), UHRP_TIMEOUT_MS),
        ),
      ]);

      // Decrypt the downloaded content
      // Use the keyID preserved from customInstructions at store time
      if (!skill.keyID) {
        throw new Error(
          `Cannot resolve body for skill "${skill.name}": missing keyID`,
        );
      }
      const keyId = skill.keyID;
      const decrypted = await this.wallet.decrypt({
        ciphertext: Array.from(downloadResult.data),
        protocolID: SKILL_PROTOCOL_ID,
        keyID: keyId,
      });

      const content = new TextDecoder().decode(new Uint8Array(decrypted.plaintext));

      // Strip YAML frontmatter, keep only the body
      const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = match ? match[1].trim() : content;

      this.bodyCache.set(skill.name, body);
      console.log(`[SkillStore] Resolved body for skill "${skill.name}" (${body.length} chars)`);
      return body;
    } catch (error) {
      console.warn(`[SkillStore] Failed to resolve body for "${skill.name}":`, error instanceof Error ? error.message : error);
      return '';
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Compose a skill markdown file with YAML frontmatter.
   */
  private composeSkillMd(skill: SkillDescriptor): string {
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `triggers: [${skill.triggers.join(', ')}]`,
      `requiredTools: [${skill.requiredTools.join(', ')}]`,
      '---',
    ].join('\n');

    return `${frontmatter}\n\n${skill.body}`;
  }
}

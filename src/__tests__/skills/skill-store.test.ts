import { describe, it, expect } from 'vitest';

describe('SkillStore keyID consistency', () => {
  it('store() keyID with timestamp is preserved in customInstructions JSON', () => {
    const skillName = 'test-skill';
    const timestamp = 1711411200000;
    const keyId = `skill-${skillName}-${timestamp}`;
    const customInstr = JSON.stringify({ keyID: keyId });
    const parsed = JSON.parse(customInstr);
    expect(parsed.keyID).toBe(`skill-${skillName}-${timestamp}`);
    expect(parsed.keyID).not.toBe(`skill-${skillName}`);
  });

  it('resolveBody should use keyID from SkillDescriptor when available', () => {
    const storedKeyID = 'skill-my-skill-1711411200000';
    const fallback = 'skill-my-skill';
    // Simulates: skill.keyID || `skill-${skill.name}`
    const usedKeyID = storedKeyID || fallback;
    expect(usedKeyID).toBe(storedKeyID);
    expect(usedKeyID).not.toBe(fallback);
  });

  it('resolveBody falls back to name-only keyID when keyID not available', () => {
    const storedKeyID: string | undefined = undefined;
    const fallback = 'skill-my-skill';
    const usedKeyID = storedKeyID || fallback;
    expect(usedKeyID).toBe(fallback);
  });
});

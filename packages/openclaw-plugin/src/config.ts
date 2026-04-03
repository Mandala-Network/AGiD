/**
 * AGiD OpenClaw Plugin Configuration
 *
 * Zod-validated config with defaults for optional fields and
 * interactive prompting for required fields.
 */

import { z } from 'zod';

export const AGiDPluginConfigSchema = z.object({
  network: z.enum(['mainnet', 'testnet']),
  storage: z.enum(['local', 'cloud']).default('local'),
  storagePath: z.string().default('~/.agid/wallet.sqlite'),
  messageboxHost: z.string().url().default('https://messagebox.babbage.systems'),
  uhrpStorageUrl: z.string().url().default('https://go-uhrp.b1nary.cloud'),
  walletClientUrl: z.string().url().default('http://localhost:3301'),
  trustedCertifiers: z.array(z.string()).default([]),
  requireCerts: z.boolean().default(false),
});

export type AGiDPluginConfig = z.infer<typeof AGiDPluginConfigSchema>;

type PromptFn = (message: string) => Promise<string>;

const DEFAULTS_USED: Array<{ field: string; value: string }> = [
  { field: 'storage', value: 'local' },
  { field: 'storagePath', value: '~/.agid/wallet.sqlite' },
  { field: 'messageboxHost', value: 'https://messagebox.babbage.systems' },
  { field: 'uhrpStorageUrl', value: 'https://go-uhrp.b1nary.cloud' },
  { field: 'walletClientUrl', value: 'http://localhost:3301' },
  { field: 'trustedCertifiers', value: '[]' },
  { field: 'requireCerts', value: 'false' },
];

/**
 * Resolve and validate plugin configuration.
 *
 * - Prompts for `network` if missing and a prompt function is available.
 * - Throws if `network` is missing and no prompt function is available.
 * - Logs warnings for optional fields falling back to defaults.
 */
export async function resolveConfig(
  raw: Record<string, unknown> = {},
  promptFn?: PromptFn,
): Promise<AGiDPluginConfig> {
  const input = { ...raw };

  // Handle missing required field: network
  if (!input.network) {
    if (promptFn) {
      const answer = await promptFn('AGiD network (mainnet/testnet):');
      input.network = answer.trim();
    } else {
      throw new Error(
        "AGiD requires 'network' to be set. Run: openclaw config set agid.network mainnet",
      );
    }
  }

  // Log warnings for optional fields using defaults
  for (const { field, value } of DEFAULTS_USED) {
    if (!(field in input) || input[field] === undefined) {
      console.warn(`[AGiD] "${field}" not configured, using default: ${value}`);
    }
  }

  return AGiDPluginConfigSchema.parse(input);
}

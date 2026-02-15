/**
 * Identity Tools
 *
 * Agent self-awareness tools - enable OpenClaw to know and prove its blockchain identity.
 * These tools expose the agent's public key and cryptographic capabilities.
 */

import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { AgentIdentity, IdentityProof } from '../types/index.js';

/**
 * Get the agent's identity information
 *
 * Returns the agent's public key, capabilities, and network.
 * This gives the agent self-awareness of its blockchain identity.
 *
 * @param wallet - Agent's wallet
 * @returns Agent identity with public key and capabilities
 *
 * @example
 * ```typescript
 * const identity = await getIdentity(wallet);
 * console.log(`I am ${identity.publicKey} on ${identity.network}`);
 * ```
 */
export async function getIdentity(wallet: AgentWallet): Promise<AgentIdentity> {
  const { publicKey } = await wallet.getPublicKey({ identityKey: true });
  const network = await wallet.getNetwork();

  return {
    publicKey,
    capabilities: ['sign', 'encrypt', 'transact'],
    network,
  };
}

/**
 * Prove the agent's identity by signing data
 *
 * Creates a cryptographic signature that proves the agent controls its identity key.
 * Anyone can verify this signature to confirm the agent's identity.
 *
 * @param wallet - Agent's wallet
 * @param data - Data to sign (proves identity at this moment)
 * @returns Identity proof with signature, public key, data, and timestamp
 *
 * @example
 * ```typescript
 * const proof = await proveIdentity(wallet, 'I am OpenClaw');
 * // proof.signature can be verified by anyone with proof.publicKey
 * ```
 */
export async function proveIdentity(wallet: AgentWallet, data: string): Promise<IdentityProof> {
  const { publicKey } = await wallet.getPublicKey({ identityKey: true });
  const dataBytes = Array.from(new TextEncoder().encode(data));
  const timestamp = Date.now();

  // Create signature using agent-identity-proof protocol
  const { signature } = await wallet.createSignature({
    data: dataBytes,
    protocolID: [2, 'agent-identity-proof'],
    keyID: `proof-${timestamp}`,
  });

  // Convert signature to hex string
  const signatureHex = signature
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    signature: signatureHex,
    publicKey,
    data,
    timestamp,
  };
}

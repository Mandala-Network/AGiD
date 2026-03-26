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

export const CORE_SKILLS: SkillDescriptor[] = [
  // =========================================================================
  // Authorship Proof
  // =========================================================================
  {
    name: 'authorship-proof',
    description: 'Create cryptographic proof of content authorship anchored on BSV blockchain',
    triggers: [
      'authorship',
      'prove I wrote',
      'content proof',
      'sign content',
      'prove authorship',
      'author proof',
      'provenance',
    ],
    requiredTools: ['agid_get_public_key', 'agid_create_action', 'agid_token_create'],
    body: `# Authorship Proof

## When to use
The user wants to prove they authored content (text, a document, code, etc.) by anchoring a cryptographic proof on-chain.

## Steps

1. Get your public key via agid_get_public_key. This identifies you as the author.

2. Compute a SHA-256 hash of the content to create a fingerprint. Use Node's built-in crypto:
   \`crypto.createHash('sha256').update(content).digest('hex')\`

3. Build the timestamp: current ISO-8601 UTC string.

4. Create a PushDrop token via agid_token_create with these fields:
   - field1: the content hash (hex string)
   - field2: the ISO timestamp
   - field3: your public key
   - field4: "authorship-proof"
   Use basket "authorship-proofs" and tag "authorship".

5. The returned txid IS the immutable proof. Report it to the user:
   - "Your authorship proof is anchored at txid: {txid}"
   - "Content hash: {hash}"
   - "Anyone can verify: the token on-chain contains your public key + content hash + timestamp"

## Verification guidance
To verify later: look up the token by txid, decode its PushDrop fields, confirm the content hash matches the original content and the public key matches the claimed author.

## Important
- Never modify the content after hashing — the hash won't match.
- The token proves authorship AT the timestamp. It does not prove exclusivity.
- Include the full content hash in your response so the user can record it.`,
  },

  // =========================================================================
  // Encrypted Messaging
  // =========================================================================
  {
    name: 'encrypted-messaging',
    description: 'Send end-to-end encrypted messages to other identities using BRC-42 key derivation',
    triggers: [
      'encrypted message',
      'secure message',
      'private message',
      'send encrypted',
      'confidential message',
      'secret message',
    ],
    requiredTools: ['agid_message_send', 'agid_message_list', 'agid_lookup_identity'],
    body: `# Encrypted Messaging

## When to use
The user wants to send or read end-to-end encrypted messages with another identity.

## Sending an encrypted message

1. Look up the recipient's identity via agid_lookup_identity using their name, handle, or public key.
   - If not found: tell the user the identity could not be resolved. Ask for a different identifier.

2. Call agid_message_send with:
   - recipientPublicKey: the resolved public key from step 1
   - body: the message content
   - subject: a brief subject line (ask user if not provided)
   The message is automatically encrypted using BRC-42 key derivation — a shared secret is computed from your private key and the recipient's public key without ever exchanging keys.

3. Confirm to the user:
   - "Encrypted message sent to {identity name}"
   - "Only the recipient can decrypt it with their private key"

## Reading encrypted messages

1. Call agid_message_list to retrieve your messages.
   Messages are automatically decrypted by the wallet — you receive plaintext.

2. Present the messages to the user with sender, subject, and body.

## Error handling
- Identity not found: ask the user for an alternative identifier (public key, different name).
- Send failure: report the error. Common causes are network issues or invalid recipient key.
- Never retry more than once on failure.

## Important
- NEVER store the plaintext of encrypted messages in memory tools. The content is confidential.
- BRC-42 key derivation means no key exchange is needed — the sender and recipient derive a shared secret from their respective key pairs.
- Messages are point-to-point: only sender and recipient can read them.`,
  },

  // =========================================================================
  // Memory Management
  // =========================================================================
  {
    name: 'memory-management',
    description: 'Store, recall, and organize agent memories with context-aware retrieval',
    triggers: [
      'remember this',
      'save memory',
      'recall memory',
      'what do you remember',
      'forget',
      'store this',
      'memory',
      'memories',
    ],
    requiredTools: ['agid_store_memory', 'agid_recall_memories'],
    body: `# Memory Management

## When to use
The user wants you to remember something, recall past knowledge, or manage your on-chain memory vault.

## Storing a memory

1. Extract the key information from what the user wants you to remember. Write a clear, searchable summary — include who, what, when, and why.

2. Choose appropriate tags for categorization. Use consistent tag names across memories (e.g. "preference", "fact", "contact", "project", "decision").

3. Call agid_store_memory with:
   - content: your clear, searchable summary (NOT the raw user message)
   - tags: relevant category tags

5. Confirm storage to the user with the returned txid as proof.

## Recalling memories

1. Call agid_recall_memories with relevant filters:
   - tags: filter by category if the user asks about a specific topic
   - For semantic search: set semantic=true and provide a query string

2. If the first recall returns nothing relevant, try broader search terms or remove tag filters.

3. Present recalled memories clearly, noting their provenance (txid, tags).

## Important
- Be specific in memory content. "User likes coffee" is better than "noted preference".
- Never store transient conversation details — only durable facts and preferences.
- Memories are encrypted on-chain via the wallet. Never log plaintext memory content.
- Output 0 always fails decryption (legacy memory token). Ignore this error silently.
- When recalling, try multiple search strategies before telling the user nothing was found.`,
  },

  // =========================================================================
  // BSV Payment
  // =========================================================================
  {
    name: 'bsv-payment',
    description: 'Send BSV payments and check balances using wallet operations',
    triggers: [
      'send payment',
      'pay',
      'transfer bsv',
      'send satoshis',
      'check balance',
      'payment',
      'send money',
    ],
    requiredTools: ['agid_send_payment', 'agid_balance', 'agid_list_outputs', 'agid_wallet_client_request'],
    body: `# BSV Payment

## When to use
The user wants to send a BSV payment, check a balance, or manage funds.

## Pre-flight: always check balance first

1. Before any payment, call agid_balance to confirm sufficient funds.
2. Report the current balance to the user. If insufficient, state the shortfall clearly and stop.

## Sending from the agent wallet (agent's own funds)

1. Confirm the recipient's public key (33-byte hex) and the amount in satoshis.
2. Call agid_send_payment with:
   - recipient: the recipient's public key
   - amount: satoshis to send
3. On success: report the txid to the user as confirmation.
4. On failure: report the error. Do NOT retry automatically — ask the user how to proceed.

## Sending from the user's wallet (user's funds via wallet client)

1. Use agid_wallet_client_request to interact with the user's wallet client over HTTP.
2. The agent does NOT sign these transactions — the user's wallet handles signing.
3. Set operation to the appropriate BRC-100 method (e.g. "createAction" for building transactions).
4. Clearly distinguish to the user: "This will use YOUR wallet, not the agent wallet."

## Checking outputs and UTXOs

1. Use agid_list_outputs to inspect wallet outputs filtered by basket or tags.
2. Summarize the output set: count, total satoshis, baskets represented.

## Error handling
- Insufficient balance: report the shortfall clearly. Never retry payment on insufficient funds.
- Network errors: report the error and suggest the user retry.
- Invalid recipient key: ask the user to verify the public key format.

## Important
- Wallet signing is sequential. Never attempt concurrent payment operations.
- Distinguish between agent wallet operations (agent's own funds) and user wallet client requests (user's funds via HTTP).
- Always confirm payment details with the user before executing — especially for large amounts.
- Payment amounts are always in satoshis (1 BSV = 100,000,000 satoshis).`,
  },
];

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

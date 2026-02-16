/**
 * OpenClaw Tools - Wallet Operations
 *
 * Exposes AGIdentity wallet capabilities to AI agents via OpenClaw.
 * Uses proven implementations from MPC-DEV reference code.
 */

import 'dotenv/config'
import { createAgentWallet } from '../../01-core/wallet/agent-wallet.js'
import type { WalletProtocol } from '@bsv/sdk'

// Type for the wallet (works with both AgentWallet and MPCWallet)
type WalletLike = any

// =============================================================================
// Crypto Operations (from MPC-DEV/mpc-test-app/backend/src/wallet/crypto-ops.ts)
// =============================================================================

interface CryptoDerivationParams {
  protocolID: WalletProtocol
  keyID: string
  counterparty?: string
}

async function encryptData(
  wallet: WalletLike,
  params: CryptoDerivationParams,
  plaintext: number[]
): Promise<{ ciphertext: number[] }> {
  const result = await wallet.encrypt({
    protocolID: params.protocolID,
    keyID: params.keyID,
    counterparty: params.counterparty,
    plaintext
  })
  return { ciphertext: result.ciphertext as number[] }
}

async function decryptData(
  wallet: WalletLike,
  params: CryptoDerivationParams,
  ciphertext: number[]
): Promise<{ plaintext: number[] }> {
  const result = await wallet.decrypt({
    protocolID: params.protocolID,
    keyID: params.keyID,
    counterparty: params.counterparty,
    ciphertext
  })
  return { plaintext: result.plaintext as number[] }
}

async function createSignatureOp(
  wallet: WalletLike,
  params: CryptoDerivationParams,
  data: number[]
): Promise<{ signature: number[] }> {
  const result = await wallet.createSignature({
    protocolID: params.protocolID,
    keyID: params.keyID,
    counterparty: params.counterparty,
    data
  })
  return { signature: result.signature as number[] }
}

// =============================================================================
// OpenClaw Tool Definitions
// =============================================================================

/**
 * Tool 1: Get Agent Identity
 * Returns the agent's public key (cryptographic identity)
 */
export const getIdentityTool = {
  name: 'agid_identity',
  description: 'Get your cryptographic identity (public key on BSV blockchain)',
  parameters: {},
  async execute() {
    const { wallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
    })

    const identity = await wallet.getPublicKey({ identityKey: true })
    const balance = await wallet.getBalanceAndUtxos()

    return {
      publicKey: identity.publicKey,
      network: process.env.AGID_NETWORK || 'testnet',
      balance: balance.total,
      status: 'active'
    }
  }
}

/**
 * Tool 2: Sign Message
 * Creates a cryptographic signature proving the agent created this message
 */
export const signMessageTool = {
  name: 'agid_sign',
  description: 'Sign a message with your private key to prove you created it',
  parameters: {
    message: {
      type: 'string',
      required: true,
      description: 'The message to sign'
    },
    protocol: {
      type: 'string',
      default: 'agent message',
      description: 'Protocol identifier (5+ chars, letters/numbers/spaces)'
    }
  },
  async execute({ message, protocol = 'agent message' }: { message: string; protocol?: string }) {
    const { wallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
    })

    const data = Array.from(Buffer.from(message, 'utf8'))
    const result = await createSignatureOp(
      wallet as any,
      {
        protocolID: [0, protocol],
        keyID: '1',
        counterparty: 'self'
      },
      data
    )

    return {
      message,
      signature: Buffer.from(result.signature).toString('hex'),
      protocol,
      signed: true
    }
  }
}

/**
 * Tool 3: Encrypt Data
 * Encrypts data using agent's private key (for self) or recipient's public key
 */
export const encryptTool = {
  name: 'agid_encrypt',
  description: 'Encrypt data for secure storage or communication',
  parameters: {
    data: {
      type: 'string',
      required: true,
      description: 'Data to encrypt (will be converted to bytes)'
    },
    protocol: {
      type: 'string',
      default: 'agent memory',
      description: 'Protocol identifier for key derivation'
    },
    keyId: {
      type: 'string',
      default: 'default',
      description: 'Key identifier for this encryption'
    },
    counterparty: {
      type: 'string',
      default: 'self',
      description: 'Recipient public key or "self" for own use'
    }
  },
  async execute({
    data,
    protocol = 'agent memory',
    keyId = 'default',
    counterparty = 'self'
  }: {
    data: string
    protocol?: string
    keyId?: string
    counterparty?: string
  }) {
    const { wallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
    })

    const plaintext = Array.from(Buffer.from(data, 'utf8'))
    const result = await encryptData(
      wallet as any,
      {
        protocolID: [0, protocol],
        keyID: keyId,
        counterparty
      },
      plaintext
    )

    return {
      ciphertext: Buffer.from(result.ciphertext).toString('hex'),
      encrypted: true,
      protocol,
      keyId,
      counterparty
    }
  }
}

/**
 * Tool 4: Decrypt Data
 * Decrypts previously encrypted data
 */
export const decryptTool = {
  name: 'agid_decrypt',
  description: 'Decrypt previously encrypted data',
  parameters: {
    ciphertext: {
      type: 'string',
      required: true,
      description: 'Hex-encoded ciphertext to decrypt'
    },
    protocol: {
      type: 'string',
      default: 'agent memory',
      description: 'Protocol identifier (must match encryption)'
    },
    keyId: {
      type: 'string',
      default: 'default',
      description: 'Key identifier (must match encryption)'
    },
    counterparty: {
      type: 'string',
      default: 'self',
      description: 'Counterparty (must match encryption)'
    }
  },
  async execute({
    ciphertext,
    protocol = 'agent memory',
    keyId = 'default',
    counterparty = 'self'
  }: {
    ciphertext: string
    protocol?: string
    keyId?: string
    counterparty?: string
  }) {
    const { wallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
    })

    const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'))
    const result = await decryptData(
      wallet as any,
      {
        protocolID: [0, protocol],
        keyID: keyId,
        counterparty
      },
      ciphertextBytes
    )

    const decryptedText = Buffer.from(result.plaintext).toString('utf8')

    return {
      plaintext: decryptedText,
      decrypted: true,
      protocol,
      keyId
    }
  }
}

/**
 * Tool 5: Check Wallet Balance
 * Returns current BSV balance and UTXOs
 */
export const checkBalanceTool = {
  name: 'agid_balance',
  description: 'Check your BSV wallet balance',
  parameters: {},
  async execute() {
    const { wallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
    })

    const balance = await wallet.getBalanceAndUtxos()

    return {
      balance: balance.total,
      satoshis: balance.total,
      utxos: balance.utxos?.length || 0,
      network: process.env.AGID_NETWORK || 'testnet'
    }
  }
}

// Export all tools as an array for easy registration
export const allTools = [
  getIdentityTool,
  signMessageTool,
  encryptTool,
  decryptTool,
  checkBalanceTool
]

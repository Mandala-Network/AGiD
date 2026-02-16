#!/usr/bin/env node
/**
 * AGIdentity MCP Server for OpenClaw
 *
 * Exposes wallet tools to OpenClaw via Model Context Protocol.
 * OpenClaw connects to this server and gets access to:
 * - Agent identity
 * - Message signing
 * - Data encryption/decryption
 * - Wallet operations
 * - Memory token creation
 */

import 'dotenv/config'
import { createAgentWallet } from '../wallet/agent-wallet.js'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from '../wallet/mpc-integration.js'
import type { AgentWallet } from '../wallet/agent-wallet.js'

// MCP Protocol
const MCP_VERSION = '2024-11-05'

// Global wallet instance
let wallet: AgentWallet

// Initialize wallet (MPC or local based on env)
async function initializeWallet() {
  if (process.env.MPC_COSIGNER_ENDPOINTS) {
    // MPC Mode
    const mpcConfig = loadMPCConfigFromEnv()
    const result = await createProductionMPCWallet(mpcConfig)
    wallet = result.wallet as unknown as AgentWallet
    console.error(`[AGID MCP] Initialized MPC wallet: ${result.collectivePublicKey}`)
  } else if (process.env.AGENT_PRIVATE_KEY) {
    // Local Mode
    const { wallet: localWallet } = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
    })
    wallet = localWallet
    const identity = await wallet.getPublicKey({ identityKey: true })
    console.error(`[AGID MCP] Initialized local wallet: ${identity.publicKey}`)
  } else {
    throw new Error('No wallet configuration found')
  }
}

// MCP Server implementation
const server = {
  async initialize() {
    await initializeWallet()
    return {
      protocolVersion: MCP_VERSION,
      serverInfo: {
        name: 'agidentity',
        version: '0.1.0'
      },
      capabilities: {
        tools: {}
      }
    }
  },

  async listTools() {
    return {
      tools: [
        {
          name: 'agid_identity',
          description: 'Get your cryptographic identity (BSV public key)',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'agid_sign',
          description: 'Sign a message with your MPC wallet to prove you created it',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message to sign' },
              protocol: { type: 'string', description: 'Protocol identifier', default: 'agent message' }
            },
            required: ['message']
          }
        },
        {
          name: 'agid_encrypt',
          description: 'Encrypt data for secure storage or communication',
          inputSchema: {
            type: 'object',
            properties: {
              data: { type: 'string', description: 'Data to encrypt' },
              protocol: { type: 'string', default: 'agent memory' },
              keyId: { type: 'string', default: 'default' },
              counterparty: { type: 'string', default: 'self' }
            },
            required: ['data']
          }
        },
        {
          name: 'agid_decrypt',
          description: 'Decrypt previously encrypted data',
          inputSchema: {
            type: 'object',
            properties: {
              ciphertext: { type: 'string', description: 'Hex-encoded ciphertext' },
              protocol: { type: 'string', default: 'agent memory' },
              keyId: { type: 'string', default: 'default' },
              counterparty: { type: 'string', default: 'self' }
            },
            required: ['ciphertext']
          }
        },
        {
          name: 'agid_balance',
          description: 'Check your BSV wallet balance',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      ]
    }
  },

  async callTool(name: string, args: any) {
    try {
      switch (name) {
        case 'agid_identity': {
          const identity = await wallet.getPublicKey({ identityKey: true })
          const balance = await wallet.getBalanceAndUtxos()
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                publicKey: identity.publicKey,
                network: process.env.AGID_NETWORK || 'mainnet',
                balance: balance.total,
                utxos: balance.utxos?.length || 0
              }, null, 2)
            }]
          }
        }

        case 'agid_sign': {
          const { message, protocol = 'agent message' } = args
          const data = Array.from(Buffer.from(message, 'utf8'))
          const result = await wallet.createSignature({
            data,
            protocolID: [0, protocol],
            keyID: '1',
            counterparty: 'self'
          })
          const signature = Buffer.from(result.signature).toString('hex')
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                message,
                signature,
                signed: true
              }, null, 2)
            }]
          }
        }

        case 'agid_encrypt': {
          const { data, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = args
          const plaintext = Array.from(Buffer.from(data, 'utf8'))
          const result = await wallet.encrypt({
            plaintext,
            protocolID: [0, protocol],
            keyID: keyId,
            counterparty
          })
          const ciphertext = Buffer.from(result.ciphertext as number[]).toString('hex')
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ciphertext,
                encrypted: true
              }, null, 2)
            }]
          }
        }

        case 'agid_decrypt': {
          const { ciphertext, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = args
          const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'))
          const result = await wallet.decrypt({
            ciphertext: ciphertextBytes,
            protocolID: [0, protocol],
            keyID: keyId,
            counterparty
          })
          const plaintext = Buffer.from(result.plaintext as number[]).toString('utf8')
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                plaintext,
                decrypted: true
              }, null, 2)
            }]
          }
        }

        case 'agid_balance': {
          const balance = await wallet.getBalanceAndUtxos()
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                balance: balance.total,
                utxos: balance.utxos?.length || 0,
                network: process.env.AGID_NETWORK || 'mainnet'
              }, null, 2)
            }]
          }
        }

        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          })
        }],
        isError: true
      }
    }
  }
}

// MCP stdio transport
process.stdin.setEncoding('utf8')
let buffer = ''

process.stdin.on('data', async (chunk) => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const request = JSON.parse(line)

      let response
      switch (request.method) {
        case 'initialize':
          response = await server.initialize()
          break
        case 'tools/list':
          response = await server.listTools()
          break
        case 'tools/call':
          response = await server.callTool(request.params.name, request.params.arguments || {})
          break
        default:
          response = { error: { code: -32601, message: 'Method not found' } }
      }

      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: response }) + '\n')
    } catch (error) {
      console.error('[AGID MCP] Error:', error)
    }
  }
})

process.on('SIGINT', () => {
  console.error('[AGID MCP] Shutting down')
  process.exit(0)
})

console.error('[AGID MCP] Server ready')

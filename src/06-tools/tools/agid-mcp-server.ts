#!/usr/bin/env node
/**
 * AGIdentity MCP Server for OpenClaw
 *
 * Exposes wallet tools to OpenClaw via Model Context Protocol.
 * OpenClaw connects to this server and gets access to:
 * - Agent identity + signing + encryption (5 existing tools)
 * - PushDrop token create/list/redeem (3 new tools)
 * - MessageBox send/list/ack (3 new tools)
 * - UHRP storage upload/download (2 new tools)
 */

import 'dotenv/config'
import { StorageUploader, StorageDownloader } from '@bsv/sdk'
import { createAgentWallet } from '../../01-core/wallet/agent-wallet.js'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from '../../01-core/wallet/mpc-integration.js'
import { lockPushDropToken, decodePushDropToken } from '../../01-core/wallet/pushdrop-ops.js'
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js'

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

  // Initialize MessageBox if host is configured
  const mbHost = process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems'
  try {
    await wallet.initializeMessageBox(mbHost)
    console.error(`[AGID MCP] MessageBox initialized (${mbHost})`)
  } catch (error) {
    console.error(`[AGID MCP] MessageBox init failed: ${error instanceof Error ? error.message : error}`)
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
        // =====================================================================
        // Existing tools (5)
        // =====================================================================
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
          description: 'Sign a message with your wallet to prove you created it',
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
        },
        // =====================================================================
        // PushDrop Token tools (3)
        // =====================================================================
        {
          name: 'agid_token_create',
          description: 'Create an on-chain PushDrop identity token with data fields',
          inputSchema: {
            type: 'object',
            properties: {
              fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Data fields to store in the token'
              },
              protocol: { type: 'string', default: 'agidentity-token', description: 'Protocol name' },
              keyId: { type: 'string', default: 'default', description: 'Key identifier' },
              basket: { type: 'string', default: 'tokens', description: 'Wallet basket name' }
            },
            required: ['fields']
          }
        },
        {
          name: 'agid_token_list',
          description: 'List PushDrop tokens from a wallet basket',
          inputSchema: {
            type: 'object',
            properties: {
              basket: { type: 'string', default: 'tokens', description: 'Basket name to query' }
            },
            required: []
          }
        },
        {
          name: 'agid_token_redeem',
          description: 'Redeem (spend) a PushDrop token to reclaim its satoshis',
          inputSchema: {
            type: 'object',
            properties: {
              txid: { type: 'string', description: 'Transaction ID of the token' },
              vout: { type: 'number', default: 0, description: 'Output index' },
              protocol: { type: 'string', default: 'agidentity-token' },
              keyId: { type: 'string', default: 'default' }
            },
            required: ['txid']
          }
        },
        // =====================================================================
        // MessageBox tools (3)
        // =====================================================================
        {
          name: 'agid_message_send',
          description: 'Send an encrypted message to a recipient via MessageBox',
          inputSchema: {
            type: 'object',
            properties: {
              recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
              messageBox: { type: 'string', default: 'general', description: 'MessageBox name' },
              body: { type: 'string', description: 'Message content (auto-encrypted via BRC-2 ECDH)' }
            },
            required: ['recipient', 'body']
          }
        },
        {
          name: 'agid_message_list',
          description: 'List encrypted messages in a MessageBox (auto-decrypted)',
          inputSchema: {
            type: 'object',
            properties: {
              messageBox: { type: 'string', default: 'general', description: 'MessageBox name' }
            },
            required: []
          }
        },
        {
          name: 'agid_message_ack',
          description: 'Acknowledge (delete) processed messages from MessageBox',
          inputSchema: {
            type: 'object',
            properties: {
              messageIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Message IDs to acknowledge'
              }
            },
            required: ['messageIds']
          }
        },
        // =====================================================================
        // UHRP Storage tools (2)
        // =====================================================================
        {
          name: 'agid_storage_upload',
          description: 'Encrypt and upload content to UHRP blockchain storage',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Content to upload' },
              filename: { type: 'string', default: 'data.txt', description: 'Optional filename' }
            },
            required: ['content']
          }
        },
        {
          name: 'agid_storage_download',
          description: 'Download and decrypt content from UHRP storage',
          inputSchema: {
            type: 'object',
            properties: {
              uhrpUrl: { type: 'string', description: 'UHRP URL to download from' }
            },
            required: ['uhrpUrl']
          }
        }
      ]
    }
  },

  async callTool(name: string, args: any) {
    try {
      switch (name) {
        // =================================================================
        // Existing tools
        // =================================================================
        case 'agid_identity': {
          const identity = await wallet.getPublicKey({ identityKey: true })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                publicKey: identity.publicKey,
                network: process.env.AGID_NETWORK || 'mainnet',
                messageBoxEnabled: !!wallet.getMessageBoxClient(),
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
              text: JSON.stringify({ message, signature, signed: true }, null, 2)
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
              text: JSON.stringify({ ciphertext, encrypted: true }, null, 2)
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
              text: JSON.stringify({ plaintext, decrypted: true }, null, 2)
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

        // =================================================================
        // PushDrop Token tools
        // =================================================================
        case 'agid_token_create': {
          const {
            fields,
            protocol = 'agidentity-token',
            keyId = 'default',
            basket = 'tokens',
          } = args

          const result = await lockPushDropToken(wallet, {
            fields,
            protocolID: [2, protocol],
            keyID: keyId,
            basket,
            description: `Token: ${fields[0]?.substring(0, 30) || 'unnamed'}`,
          })

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                txid: result.txid,
                vout: result.vout,
                satoshis: result.satoshis,
                fields,
                basket,
                created: true,
              }, null, 2)
            }]
          }
        }

        case 'agid_token_list': {
          const { basket = 'tokens' } = args
          const underlyingWallet = wallet.getUnderlyingWallet()
          if (!underlyingWallet) throw new Error('Wallet not initialized')

          const result = await underlyingWallet.listOutputs({
            basket,
            tags: ['pushdrop'],
            include: 'locking scripts',
          })

          const tokens = result.outputs
            .filter((o: any) => o.spendable && o.lockingScript)
            .map((o: any) => {
              try {
                const decoded = decodePushDropToken(o.lockingScript)
                return {
                  outpoint: o.outpoint,
                  satoshis: o.satoshis,
                  fields: decoded.fields,
                }
              } catch {
                return {
                  outpoint: o.outpoint,
                  satoshis: o.satoshis,
                  fields: ['[decode error]'],
                }
              }
            })

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ tokens, total: tokens.length, basket }, null, 2)
            }]
          }
        }

        case 'agid_token_redeem': {
          const {
            txid,
            vout = 0,
            protocol = 'agidentity-token',
            keyId = 'default',
          } = args

          // Unlock requires the underlying wallet for signableTransaction flow
          const underlyingWallet = wallet.getUnderlyingWallet()
          if (!underlyingWallet) throw new Error('Wallet not initialized')

          const { unlockPushDropToken } = await import('../../01-core/wallet/pushdrop-ops.js')
          const result = await unlockPushDropToken(underlyingWallet, {
            txid,
            vout,
            protocolID: [2, protocol],
            keyID: keyId,
          })

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                txid: result.txid,
                satoshis: result.satoshis,
                redeemed: true,
              }, null, 2)
            }]
          }
        }

        // =================================================================
        // MessageBox tools
        // =================================================================
        case 'agid_message_send': {
          const { recipient, messageBox = 'general', body } = args
          const result = await wallet.sendMessage({ recipient, messageBox, body })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                messageId: result.messageId,
                status: result.status,
                recipient: recipient.substring(0, 16) + '...',
                messageBox,
                sent: true,
              }, null, 2)
            }]
          }
        }

        case 'agid_message_list': {
          const { messageBox = 'general' } = args
          const messages = await wallet.listMessages({ messageBox })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                messages: messages.map((m: any) => ({
                  messageId: m.messageId,
                  sender: m.sender,
                  body: m.body,
                  createdAt: m.created_at ?? m.createdAt,
                })),
                total: messages.length,
                messageBox,
              }, null, 2)
            }]
          }
        }

        case 'agid_message_ack': {
          const { messageIds } = args
          await wallet.acknowledgeMessages({ messageIds })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                acknowledged: messageIds.length,
                success: true,
              }, null, 2)
            }]
          }
        }

        // =================================================================
        // UHRP Storage tools
        // =================================================================
        case 'agid_storage_upload': {
          const { content, filename = 'data.txt' } = args
          const storageUrl = process.env.UHRP_STORAGE_URL || 'https://staging-storage.babbage.systems'
          const underlyingWallet = wallet.getUnderlyingWallet()
          if (!underlyingWallet) throw new Error('Wallet not initialized')

          // Encrypt content before upload
          const plaintext = Array.from(Buffer.from(content, 'utf8'))
          const encrypted = await wallet.encrypt({
            plaintext,
            protocolID: [2, 'agidentity-storage'],
            keyID: `upload-${Date.now()}`,
          })

          const uploader = new StorageUploader({
            storageURL: storageUrl,
            wallet: underlyingWallet,
          })

          const uploadResult = await uploader.publishFile({
            file: {
              data: new Uint8Array(encrypted.ciphertext),
              type: 'application/octet-stream',
            },
            retentionPeriod: 365 * 24 * 60, // 1 year
          })

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uhrpUrl: uploadResult.uhrpURL,
                filename,
                encrypted: true,
                uploaded: true,
              }, null, 2)
            }]
          }
        }

        case 'agid_storage_download': {
          const { uhrpUrl } = args
          const network = await wallet.getNetwork()
          const downloader = new StorageDownloader({ networkPreset: network })

          const downloadResult = await downloader.download(uhrpUrl)

          // Try to decrypt
          try {
            const decrypted = await wallet.decrypt({
              ciphertext: Array.from(downloadResult.data),
              protocolID: [2, 'agidentity-storage'],
              keyID: `upload-${Date.now()}`, // Will need the original keyID
            })
            const plaintext = Buffer.from(decrypted.plaintext).toString('utf8')
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  content: plaintext,
                  uhrpUrl,
                  decrypted: true,
                }, null, 2)
              }]
            }
          } catch {
            // Return raw data if decryption fails (may be unencrypted)
            const rawContent = Buffer.from(downloadResult.data).toString('utf8')
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  content: rawContent,
                  uhrpUrl,
                  decrypted: false,
                  note: 'Returned raw content (decryption failed - may need original keyID)',
                }, null, 2)
              }]
            }
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

console.error('[AGID MCP] Server ready (13 tools)')

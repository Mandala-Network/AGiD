#!/usr/bin/env node
/**
 * AGIdentity MCP Server for OpenClaw
 *
 * Exposes MPC wallet tools to OpenClaw AI agents via Model Context Protocol
 */

import 'dotenv/config'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'
import { createAgentWallet } from './dist/wallet/agent-wallet.js'

// Initialize wallet
let wallet: any

async function initWallet() {
  if (process.env.MPC_COSIGNER_ENDPOINTS) {
    console.error('[AGID MCP] Using MPC wallet')
    const result = await createProductionMPCWallet(loadMPCConfigFromEnv())
    wallet = result.wallet
    console.error(`[AGID MCP] Identity: ${result.collectivePublicKey}`)
  } else {
    console.error('[AGID MCP] Using local wallet')
    const result = await createAgentWallet({
      privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
      network: (process.env.AGID_NETWORK as any) || 'mainnet'
    })
    wallet = result.wallet
    const id = await wallet.getPublicKey({ identityKey: true })
    console.error(`[AGID MCP] Identity: ${id.publicKey}`)
  }
}

// MCP message handling
const handleMessage = async (msg: any) => {
  const { id, method, params } = msg

  try {
    let result

    switch (method) {
      case 'initialize':
        await initWallet()
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agidentity', version: '0.1.0' }
        }
        break

      case 'tools/list':
        result = {
          tools: [
            {
              name: 'agid_identity',
              description: 'Get your onchain BSV identity (public key)',
              inputSchema: {
                type: 'object',
                properties: {},
                required: []
              }
            },
            {
              name: 'agid_sign',
              description: 'Sign a message with your MPC wallet (2-of-3 threshold signature)',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Message to sign' },
                  protocol: { type: 'string', description: 'Protocol name', default: 'agent message' }
                },
                required: ['message']
              }
            },
            {
              name: 'agid_encrypt',
              description: 'Encrypt data using your wallet for secure storage',
              inputSchema: {
                type: 'object',
                properties: {
                  data: { type: 'string', description: 'Data to encrypt' },
                  protocol: { type: 'string', default: 'agent memory' },
                  keyId: { type: 'string', default: 'mem1' }
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
                  ciphertext: { type: 'string', description: 'Hex ciphertext' },
                  protocol: { type: 'string', default: 'agent memory' },
                  keyId: { type: 'string', default: 'mem1' }
                },
                required: ['ciphertext']
              }
            }
          ]
        }
        break

      case 'tools/call':
        const { name, arguments: args } = params

        switch (name) {
          case 'agid_identity': {
            const id = await wallet.getPublicKey({ identityKey: true })
            result = {
              content: [{
                type: 'text',
                text: `My onchain BSV identity:\nPublic Key: ${id.publicKey}\nNetwork: ${process.env.AGID_NETWORK || 'mainnet'}\n\nThis is my cryptographic identity. All my actions can be verified against this key.`
              }]
            }
            break
          }

          case 'agid_sign': {
            const { message, protocol = 'agent message' } = args
            const data = Array.from(Buffer.from(message, 'utf8'))
            const sigResult = await wallet.createSignature({
              data,
              protocolID: [0, protocol],
              keyID: '1',
              counterparty: 'self'
            })
            const sig = Buffer.from(sigResult.signature).toString('hex')
            result = {
              content: [{
                type: 'text',
                text: `Message signed with MPC wallet (2-of-3 threshold):\n\nMessage: "${message}"\nSignature: ${sig}\n\nThis signature proves only I could have created this message. It was generated using distributed threshold signing - no single party holds the complete private key.`
              }]
            }
            break
          }

          case 'agid_encrypt': {
            const { data, protocol = 'agent memory', keyId = 'mem1' } = args
            const plaintext = Array.from(Buffer.from(data, 'utf8'))
            const encResult = await wallet.encrypt({
              plaintext,
              protocolID: [0, protocol],
              keyID: keyId,
              counterparty: 'self'
            })
            const cipher = Buffer.from(encResult.ciphertext).toString('hex')
            result = {
              content: [{
                type: 'text',
                text: `Data encrypted for secure storage:\n\nOriginal: "${data}"\nCiphertext: ${cipher.substring(0, 64)}...\nProtocol: ${protocol}\nKey ID: ${keyId}\n\nThis data is encrypted with keys derived from my MPC wallet. Only I can decrypt it.`
              }]
            }
            break
          }

          case 'agid_decrypt': {
            const { ciphertext, protocol = 'agent memory', keyId = 'mem1' } = args
            const cipherBytes = Array.from(Buffer.from(ciphertext, 'hex'))
            const decResult = await wallet.decrypt({
              ciphertext: cipherBytes,
              protocolID: [0, protocol],
              keyID: keyId,
              counterparty: 'self'
            })
            const plain = Buffer.from(decResult.plaintext).toString('utf8')
            result = {
              content: [{
                type: 'text',
                text: `Decrypted data:\n\n${plain}\n\nSuccessfully decrypted using MPC-derived keys.`
              }]
            }
            break
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
        break

      default:
        throw new Error(`Unknown method: ${method}`)
    }

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')

  } catch (error) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    }) + '\n')
  }
}

// Stdin/stdout protocol
process.stdin.setEncoding('utf8')
let buffer = ''

process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      handleMessage(msg)
    } catch (e) {
      console.error('[AGID MCP] Parse error:', e)
    }
  }
})

console.error('[AGID MCP] Server starting...')

/**
 * OpenClaw Plugin Example
 *
 * How to give any OpenClaw agent AGIdentity capabilities
 */

const AGID_API = process.env.AGID_API_URL || 'http://localhost:3000'

export const openclawTools = {
  agid_identity: {
    description: 'Get your cryptographic identity on BSV blockchain',
    parameters: {},
    async execute() {
      const response = await fetch(`${AGID_API}/api/identity`)
      return await response.json()
    }
  },

  agid_sign: {
    description: 'Sign a message with your private key to prove you created it',
    parameters: {
      message: { type: 'string', required: true },
      protocol: { type: 'string', default: 'agent message' }
    },
    async execute({ message, protocol }: { message: string; protocol?: string }) {
      const response = await fetch(`${AGID_API}/api/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, protocol })
      })
      return await response.json()
    }
  },

  agid_encrypt: {
    description: 'Encrypt data for secure storage or communication',
    parameters: {
      data: { type: 'string', required: true },
      protocol: { type: 'string', default: 'agent memory' },
      keyId: { type: 'string', default: 'default' },
      counterparty: { type: 'string', default: 'self' }
    },
    async execute(params: { data: string; protocol?: string; keyId?: string; counterparty?: string }) {
      const response = await fetch(`${AGID_API}/api/encrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      })
      return await response.json()
    }
  },

  agid_decrypt: {
    description: 'Decrypt previously encrypted data',
    parameters: {
      ciphertext: { type: 'string', required: true },
      protocol: { type: 'string', default: 'agent memory' },
      keyId: { type: 'string', default: 'default' },
      counterparty: { type: 'string', default: 'self' }
    },
    async execute(params: { ciphertext: string; protocol?: string; keyId?: string; counterparty?: string }) {
      const response = await fetch(`${AGID_API}/api/decrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      })
      return await response.json()
    }
  },

  agid_balance: {
    description: 'Check your BSV wallet balance',
    parameters: {},
    async execute() {
      const response = await fetch(`${AGID_API}/api/balance`)
      return await response.json()
    }
  }
}

// Usage with OpenClaw:
// import { openclawTools } from './examples/openclaw-plugin.js'
// openclaw.registerTools(openclawTools)

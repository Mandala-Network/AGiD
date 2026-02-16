/**
 * Simple JavaScript Client Example
 *
 * How to give ANY JavaScript/Node agent AGIdentity capabilities.
 * Works with: Custom agents, ZeroClaw, PicoClaw, etc.
 */

const AGID_API = process.env.AGID_API_URL || 'http://localhost:3000'

class AGIdentityClient {
  constructor(apiUrl = AGID_API) {
    this.apiUrl = apiUrl
  }

  async getIdentity() {
    const response = await fetch(`${this.apiUrl}/api/identity`)
    return await response.json()
  }

  async sign(message, protocol = 'agent message') {
    const response = await fetch(`${this.apiUrl}/api/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, protocol })
    })
    return await response.json()
  }

  async encrypt(data, options = {}) {
    const response = await fetch(`${this.apiUrl}/api/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        protocol: options.protocol || 'agent memory',
        keyId: options.keyId || 'default',
        counterparty: options.counterparty || 'self'
      })
    })
    return await response.json()
  }

  async decrypt(ciphertext, options = {}) {
    const response = await fetch(`${this.apiUrl}/api/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciphertext,
        protocol: options.protocol || 'agent memory',
        keyId: options.keyId || 'default',
        counterparty: options.counterparty || 'self'
      })
    })
    return await response.json()
  }

  async checkBalance() {
    const response = await fetch(`${this.apiUrl}/api/balance`)
    return await response.json()
  }
}

// Example: Give any agent onchain identity in 3 lines
async function demo() {
  const agent = new AGIdentityClient()

  console.log('🤖 JavaScript Agent with AGIdentity\n')

  // Agent gets identity
  const identity = await agent.getIdentity()
  console.log(`✅ My identity: ${identity.publicKey.substring(0, 32)}...`)

  // Agent signs message
  const signature = await agent.sign('I am an autonomous agent')
  console.log(`✅ Signed message: ${signature.signature.substring(0, 64)}...`)

  // Agent encrypts memory
  const encrypted = await agent.encrypt('Remember this for later')
  console.log(`✅ Encrypted: ${encrypted.ciphertext.substring(0, 64)}...`)

  // Agent decrypts
  const decrypted = await agent.decrypt(encrypted.ciphertext)
  console.log(`✅ Decrypted: "${decrypted.plaintext}"`)

  // Agent checks funds
  const balance = await agent.checkBalance()
  console.log(`✅ Balance: ${balance.balance} satoshis\n`)

  console.log('🔌 Universal plugin - works with ANY JavaScript agent!')
}

// Export for use in other agents
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AGIdentityClient }
}

// Run demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch(console.error)
}

#!/usr/bin/env tsx
/**
 * AGIdentity Prototype Demo
 *
 * Demonstrates core agent capabilities:
 * 1. Agent has cryptographic identity (wallet)
 * 2. Agent can sign transactions
 * 3. Agent can create encrypted memories
 * 4. Agent can send/receive encrypted messages
 *
 * Run: npx tsx prototype-demo.ts
 */

import { createAGIdentity } from './dist/index.js'
import type { AGIdentityConfig } from './dist/types/index.js'

async function runPrototype() {
  console.log('\n🤖 AGIdentity Prototype Demo\n')
  console.log('=' .repeat(60))

  // Step 1: Create Agent Identity
  console.log('\n📋 Step 1: Creating Agent Identity...')

  const config: AGIdentityConfig = {
    storageUrl: 'https://go-uhrp.b1nary.cloud',
    network: 'testnet',
    agentWallet: {
      privateKeyHex: process.env.AGENT_PRIVATE_KEY ||
                     '0000000000000000000000000000000000000000000000000000000000000001',
      storagePath: './.agid-demo',
      network: 'testnet',
      storageMode: 'local',
    },
  }

  const agent = await createAGIdentity(config)

  // Get agent identity
  const identity = await agent.wallet.getPublicKey({ reason: 'demo' })
  console.log('✅ Agent Identity Created!')
  console.log(`   Public Key: ${identity.publicKey}`)
  console.log(`   Identity: ${identity.identityKey || 'N/A'}`)

  // Step 2: Sign a Transaction
  console.log('\n📝 Step 2: Creating and Signing Transaction...')

  try {
    const message = 'Hello from AGIdentity agent!'
    const signature = await agent.wallet.createSignature({
      data: Buffer.from(message).toString('hex'),
      protocolID: [0, 'demo'],
      keyID: '1',
      counterparty: 'self',
    })

    console.log('✅ Transaction Signed!')
    console.log(`   Message: "${message}"`)
    console.log(`   Signature: ${signature.substring(0, 32)}...`)

    // Verify signature
    const isValid = await agent.wallet.verifySignature({
      data: Buffer.from(message).toString('hex'),
      signature,
      protocolID: [0, 'demo'],
      keyID: '1',
      counterparty: 'self',
    })
    console.log(`   Verification: ${isValid ? '✅ Valid' : '❌ Invalid'}`)
  } catch (error) {
    console.log('⚠️  Transaction signing demo skipped:', error instanceof Error ? error.message : String(error))
  }

  // Step 3: Create Encrypted Memory
  console.log('\n🧠 Step 3: Creating Encrypted Memory...')

  try {
    const memory = {
      timestamp: new Date().toISOString(),
      content: 'I am an autonomous agent with cryptographic identity. I can sign transactions, store encrypted memories, and communicate securely.',
      tags: ['demo', 'identity', 'prototype'],
    }

    const memoryJson = JSON.stringify(memory)

    // Encrypt using wallet
    const encrypted = await agent.wallet.encrypt({
      plaintext: Buffer.from(memoryJson).toString('hex'),
      protocolID: [0, 'demo-memory'],
      keyID: '1',
      counterparty: 'self',
    })

    console.log('✅ Memory Encrypted!')
    console.log(`   Original Size: ${memoryJson.length} bytes`)
    console.log(`   Encrypted: ${encrypted.substring(0, 32)}...`)

    // Store to vault
    await agent.vault.uploadDocument(
      'self',
      'memories/demo-' + Date.now() + '.json',
      encrypted
    )
    console.log('   Stored to vault via UHRP')

    // Decrypt to verify
    const decrypted = await agent.wallet.decrypt({
      ciphertext: encrypted,
      protocolID: [0, 'demo-memory'],
      keyID: '1',
      counterparty: 'self',
    })
    const recovered = JSON.parse(Buffer.from(decrypted, 'hex').toString())
    console.log(`   Decryption: ${recovered.content.substring(0, 50)}...`)
  } catch (error) {
    console.log('⚠️  Memory encryption demo skipped:', error instanceof Error ? error.message : String(error))
  }

  // Step 4: Encrypt Message for Another Agent
  console.log('\n💬 Step 4: Encrypting Message for Communication...')

  try {
    // Simulate another agent's public key (in real use, this would be from certificate exchange)
    const recipientKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    const message = {
      from: identity.publicKey,
      to: recipientKey,
      timestamp: new Date().toISOString(),
      content: 'Hello! I am an autonomous agent. Let us collaborate.',
      signature: '[signed]',
    }

    const encryptedMessage = await agent.wallet.encrypt({
      plaintext: Buffer.from(JSON.stringify(message)).toString('hex'),
      protocolID: [0, 'demo-message'],
      keyID: '1',
      counterparty: recipientKey,
    })

    console.log('✅ Message Encrypted for Recipient!')
    console.log(`   From: ${message.from.substring(0, 16)}...`)
    console.log(`   To: ${message.to.substring(0, 16)}...`)
    console.log(`   Content: "${message.content}"`)
    console.log(`   Encrypted: ${encryptedMessage.substring(0, 32)}...`)
    console.log('   (Only recipient can decrypt with their private key)')
  } catch (error) {
    console.log('⚠️  Message encryption demo skipped:', error instanceof Error ? error.message : String(error))
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('\n✨ Prototype Demo Complete!\n')
  console.log('Your agent can now:')
  console.log('  ✅ Maintain cryptographic identity')
  console.log('  ✅ Sign transactions and messages')
  console.log('  ✅ Create encrypted memories')
  console.log('  ✅ Encrypt messages for secure communication')
  console.log('\n📚 Next Steps:')
  console.log('  1. Integrate with OpenClaw for AI capabilities')
  console.log('  2. Enable MessageBox for P2P messaging')
  console.log('  3. Connect to BSV blockchain for transactions')
  console.log('  4. Add UHRP for distributed storage')
  console.log('\n🚀 Vision: Autonomous AI agent with verifiable identity!\n')
}

// Run the prototype
runPrototype().catch(error => {
  console.error('\n❌ Prototype failed:', error)
  process.exit(1)
})

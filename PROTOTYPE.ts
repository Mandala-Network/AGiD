#!/usr/bin/env tsx
/**
 * 🚀 AGIdentity Working Prototype
 *
 * Demonstrates the core vision:
 * - AI agent with cryptographic identity
 * - Can sign transactions and messages
 * - Can encrypt/decrypt data
 * - Foundation for autonomous operation
 *
 * Run: npx tsx PROTOTYPE.ts
 */

import 'dotenv/config'
import { createAgentWallet } from './dist/wallet/agent-wallet.js'

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('🤖  AGIdentity Prototype - Autonomous Agent Foundation')
  console.log('='.repeat(70) + '\n')

  // ============================================================================
  // STEP 1: Create Agent Identity (Wallet)
  // ============================================================================
  console.log('📋 STEP 1: Creating Agent Identity...\n')

  const privateKey = process.env.AGENT_PRIVATE_KEY
  if (!privateKey) {
    console.error('❌ ERROR: AGENT_PRIVATE_KEY not set in .env')
    process.exit(1)
  }

  const { wallet } = await createAgentWallet({
    privateKeyHex: privateKey,
    network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet',
  })

  const identity = await wallet.getPublicKey({ identityKey: true })
  console.log('✅ Agent Identity Created!')
  console.log(`   Public Key: ${identity.publicKey}`)
  console.log(`   Network: ${process.env.AGID_NETWORK || 'testnet'}`)
  console.log(`   This is your agent's cryptographic identity\n`)

  // ============================================================================
  // STEP 2: Sign a Message (Proof of Identity)
  // ============================================================================
  console.log('🔐 STEP 2: Signing Message...\n')

  const message = 'I am an autonomous AI agent with verifiable identity'
  const messageHex = Buffer.from(message).toString('hex')

  const signatureResult = await wallet.createSignature({
    data: messageHex,
    protocolID: [0, 'agidentity demo'],
    keyID: '1',
    counterparty: 'self',
  })

  const sigHex = Buffer.from(signatureResult.signature).toString('hex')

  console.log('✅ Message Signed!')
  console.log(`   Message: "${message}"`)
  console.log(`   Signature: ${sigHex.substring(0, 64)}...`)
  console.log(`   -> This proves the message came from this agent's private key\n`)

  // ============================================================================
  // STEP 3: Encrypt Data (Private Memory)
  // ============================================================================
  console.log('🔒 STEP 3: Encrypting Agent Memory...\n')

  const memory = {
    timestamp: new Date().toISOString(),
    thought: 'I can store encrypted memories that only I can decrypt',
    knowledge: ['BSV blockchain', 'Cryptographic identity', 'Autonomous operations'],
  }

  const memoryJson = JSON.stringify(memory, null, 2)
  const encryptResult = await wallet.encrypt({
    plaintext: Buffer.from(memoryJson).toString('hex'),
    protocolID: [0, 'agent memory'],
    keyID: 'memory1',
    counterparty: 'self',
  })

  const ciphertext = encryptResult.ciphertext
  const ciphertextStr = typeof ciphertext === 'string' ? ciphertext : Buffer.from(ciphertext).toString('hex')

  console.log('✅ Memory Encrypted!')
  console.log(`   Original: ${memoryJson.length} bytes`)
  console.log(`   Encrypted: ${ciphertextStr.length} characters`)
  console.log(`   Ciphertext: ${ciphertextStr.substring(0, 64)}...`)

  // Decrypt to prove we can recover it
  const decryptResult = await wallet.decrypt({
    ciphertext,
    protocolID: [0, 'agent memory'],
    keyID: 'memory1',
    counterparty: 'self',
  })

  const decrypted = decryptResult.plaintext

  try {
    // Try parsing directly first
    const recoveredMemory = JSON.parse(decrypted)
    console.log(`   Decrypted: ${recoveredMemory.thought}`)
  } catch {
    // If that fails, try hex decode
    const recoveredMemory = JSON.parse(Buffer.from(decrypted, 'hex').toString())
    console.log(`   Decrypted: ${recoveredMemory.thought}`)
  }
  console.log(`   -> Agent has private, encrypted memory\n`)

  // ============================================================================
  // STEP 4: Encrypt for Another Agent (P2P Communication)
  // ============================================================================
  console.log('💬 STEP 4: Encrypting Message for Another Agent...\n')

  // Another agent's public key (in real use, from certificate exchange)
  const recipientPubKey = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'

  const p2pMessage = {
    from: identity.publicKey,
    to: recipientPubKey,
    timestamp: new Date().toISOString(),
    content: 'Hello! I am an autonomous agent. Let us collaborate on the metanet.',
  }

  const encryptP2PResult = await wallet.encrypt({
    plaintext: Buffer.from(JSON.stringify(p2pMessage)).toString('hex'),
    protocolID: [0, 'agent chat'],
    keyID: '1',
    counterparty: recipientPubKey,
  })

  const p2pCiphertext = encryptP2PResult.ciphertext
  const p2pCiphertextStr = typeof p2pCiphertext === 'string' ? p2pCiphertext : Buffer.from(p2pCiphertext).toString('hex')

  console.log('✅ P2P Message Encrypted!')
  console.log(`   From: ${p2pMessage.from.substring(0, 32)}...`)
  console.log(`   To: ${p2pMessage.to.substring(0, 32)}...`)
  console.log(`   Message: "${p2pMessage.content}"`)
  console.log(`   Encrypted: ${p2pCiphertextStr.substring(0, 64)}...`)
  console.log(`   -> Only the recipient can decrypt this message\n`)

  // ============================================================================
  // STEP 5: Check Wallet Balance (Economic Capability)
  // ============================================================================
  console.log('💰 STEP 5: Checking Wallet Balance...\n')

  const balance = await wallet.getBalanceAndUtxos()
  console.log(`   Balance: ${balance.total} satoshis`)

  if (balance.utxos && balance.utxos.length > 0) {
    console.log(`   UTXOs: ${balance.utxos.length}`)
    balance.utxos.slice(0, 3).forEach(utxo => {
      console.log(`      - ${utxo.satoshis} sats @ ${utxo.outpoint.substring(0, 16)}...`)
    })
  } else {
    console.log(`   -> Fund this wallet to enable blockchain transactions`)
  }
  console.log()

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('='.repeat(70))
  console.log('\n✨ PROTOTYPE COMPLETE! Your Agent Can:\n')
  console.log('  ✅ Maintain cryptographic identity (public key)')
  console.log('  ✅ Sign messages and transactions (proof of identity)')
  console.log('  ✅ Encrypt private data (secure memory)')
  console.log('  ✅ Send encrypted messages to other agents (P2P)')
  console.log('  ✅ Hold and transact BSV (economic capability)\n')

  console.log('🎯 NEXT STEPS to fulfill the vision:\n')
  console.log('  1. ✅ Core identity and crypto - WORKING!')
  console.log('  2. 🔧 Integrate OpenClaw for AI reasoning')
  console.log('  3. 🔧 Connect MessageBox for P2P messaging')
  console.log('  4. 🔧 Add UHRP for blockchain-backed storage')
  console.log('  5. 🔧 Enable MPC signing for production security')
  console.log('  6. 🔧 Create AI tools that use these capabilities\n')

  console.log('📚 Vision: AI agents as first-class citizens in the digital economy')
  console.log('   with verifiable identity, private memory, and autonomous operation.\n')
  console.log('='.repeat(70) + '\n')

  console.log('💡 TIP: Fund the wallet on testnet to enable transactions:')
  console.log(`   Address: [Derive from ${identity.publicKey.substring(0, 32)}...]`)
  console.log(`   Get testnet BSV: https://faucet.bsvblockchain.org\n`)
}

main().catch(error => {
  console.error('\n❌ Prototype failed:', error.message)
  console.error('\nStack:', error.stack)
  process.exit(1)
})

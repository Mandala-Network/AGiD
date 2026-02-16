#!/usr/bin/env tsx
/**
 * Test Wallet Tools
 *
 * Tests all OpenClaw wallet tools to ensure they work correctly
 * before integrating with OpenClaw AI agent.
 */

import 'dotenv/config'
import {
  getIdentityTool,
  signMessageTool,
  encryptTool,
  decryptTool,
  checkBalanceTool
} from '../dist/06-tools/tools/wallet-tools.js'

console.log('\n' + '='.repeat(70))
console.log('🧪 Testing AGIdentity Wallet Tools for OpenClaw')
console.log('='.repeat(70) + '\n')

async function runTests() {
  let testsPassed = 0
  let testsFailed = 0

  // ==========================================================================
  // Test 1: Get Identity
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 1: Get Agent Identity')
  console.log('━'.repeat(70))
  try {
    const result = await getIdentityTool.execute()
    console.log('✅ PASSED')
    console.log(`   Public Key: ${result.publicKey}`)
    console.log(`   Network: ${result.network}`)
    console.log(`   Balance: ${result.balance} satoshis`)
    console.log(`   Status: ${result.status}\n`)
    testsPassed++
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error))
    testsFailed++
  }

  // ==========================================================================
  // Test 2: Sign Message
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 2: Sign Message')
  console.log('━'.repeat(70))
  try {
    const testMessage = 'I am an autonomous agent with cryptographic identity'
    const result = await signMessageTool.execute({
      message: testMessage,
      protocol: 'agent signing'
    })
    console.log('✅ PASSED')
    console.log(`   Message: "${result.message}"`)
    console.log(`   Protocol: ${result.protocol}`)
    console.log(`   Signature: ${result.signature.substring(0, 64)}...`)
    console.log(`   Signed: ${result.signed}\n`)
    testsPassed++
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error))
    testsFailed++
  }

  // ==========================================================================
  // Test 3: Encrypt Data
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 3: Encrypt Data')
  console.log('━'.repeat(70))
  try {
    const secretData = 'This is my secret agent memory that only I can read'
    const result = await encryptTool.execute({
      data: secretData,
      protocol: 'test memory',
      keyId: 'test001',
      counterparty: 'self'
    })
    console.log('✅ PASSED')
    console.log(`   Original: "${secretData}"`)
    console.log(`   Encrypted: ${result.ciphertext.substring(0, 64)}...`)
    console.log(`   Protocol: ${result.protocol}`)
    console.log(`   Key ID: ${result.keyId}`)
    console.log(`   Counterparty: ${result.counterparty}\n`)

    // Save for decryption test
    global.testCiphertext = result.ciphertext
    testsPassed++
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error))
    testsFailed++
  }

  // ==========================================================================
  // Test 4: Decrypt Data
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 4: Decrypt Data')
  console.log('━'.repeat(70))
  try {
    const result = await decryptTool.execute({
      ciphertext: global.testCiphertext,
      protocol: 'test memory',
      keyId: 'test001',
      counterparty: 'self'
    })
    console.log('✅ PASSED')
    console.log(`   Decrypted: "${result.plaintext}"`)
    console.log(`   Protocol: ${result.protocol}`)
    console.log(`   Key ID: ${result.keyId}`)
    console.log(`   Match: ${result.plaintext === 'This is my secret agent memory that only I can read'}\n`)
    testsPassed++
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error))
    testsFailed++
  }

  // ==========================================================================
  // Test 5: Check Balance
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 5: Check Balance')
  console.log('━'.repeat(70))
  try {
    const result = await checkBalanceTool.execute()
    console.log('✅ PASSED')
    console.log(`   Balance: ${result.balance} satoshis`)
    console.log(`   UTXOs: ${result.utxos}`)
    console.log(`   Network: ${result.network}\n`)
    testsPassed++
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error))
    testsFailed++
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('='.repeat(70))
  console.log('📊 TEST SUMMARY')
  console.log('='.repeat(70))
  console.log(`✅ Passed: ${testsPassed}`)
  console.log(`❌ Failed: ${testsFailed}`)
  console.log(`📦 Total:  ${testsPassed + testsFailed}`)
  console.log()

  if (testsFailed === 0) {
    console.log('🎉 ALL TESTS PASSED! Tools are ready for OpenClaw integration.\n')
    console.log('Next steps:')
    console.log('  1. Install OpenClaw: npm install openclaw')
    console.log('  2. Create OpenClaw config with these tools')
    console.log('  3. Start OpenClaw agent with AGIdentity capabilities\n')
    console.log('='.repeat(70) + '\n')
    process.exit(0)
  } else {
    console.log('⚠️  Some tests failed. Review errors above.\n')
    console.log('='.repeat(70) + '\n')
    process.exit(1)
  }
}

// Extend global for test data sharing
declare global {
  var testCiphertext: string
}

runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error)
  process.exit(1)
})

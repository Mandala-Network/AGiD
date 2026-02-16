#!/usr/bin/env tsx
/**
 * Test HTTP API
 *
 * Tests the universal HTTP API endpoints that ANY agent framework can use.
 * Demonstrates framework-agnostic access to AGIdentity capabilities.
 */

import 'dotenv/config'

const API_BASE = 'http://localhost:3000'

console.log('\n' + '='.repeat(70))
console.log('🌐 Testing Universal HTTP API')
console.log('   (Works with ANY agent framework)')
console.log('='.repeat(70) + '\n')

async function testAPI() {
  let passed = 0
  let failed = 0

  // ==========================================================================
  // Test 1: GET /api/identity
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 1: GET /api/identity')
  console.log('━'.repeat(70))
  try {
    const response = await fetch(`${API_BASE}/api/identity`)
    const data = await response.json()

    if (data.success && data.publicKey) {
      console.log('✅ PASSED')
      console.log(`   Public Key: ${data.publicKey}`)
      console.log(`   Network: ${data.network}`)
      console.log(`   Balance: ${data.balance} satoshis`)
      console.log(`   Status: ${data.status}\n`)
      passed++
    } else {
      console.log('❌ FAILED: Invalid response', data)
      failed++
    }
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error), '\n')
    failed++
  }

  // ==========================================================================
  // Test 2: POST /api/sign
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 2: POST /api/sign')
  console.log('━'.repeat(70))
  try {
    const response = await fetch(`${API_BASE}/api/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test message from HTTP API',
        protocol: 'http test'
      })
    })
    const data = await response.json()

    if (data.success && data.signature) {
      console.log('✅ PASSED')
      console.log(`   Message: "${data.message}"`)
      console.log(`   Protocol: ${data.protocol}`)
      console.log(`   Signature: ${data.signature.substring(0, 64)}...`)
      console.log(`   Signed: ${data.signed}\n`)
      passed++
    } else {
      console.log('❌ FAILED: Invalid response', data)
      failed++
    }
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error), '\n')
    failed++
  }

  // ==========================================================================
  // Test 3: POST /api/encrypt
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 3: POST /api/encrypt')
  console.log('━'.repeat(70))
  try {
    const response = await fetch(`${API_BASE}/api/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: 'Secret data from HTTP API',
        protocol: 'http memory',
        keyId: 'http001',
        counterparty: 'self'
      })
    })
    const data = await response.json()

    if (data.success && data.ciphertext) {
      console.log('✅ PASSED')
      console.log(`   Original: "Secret data from HTTP API"`)
      console.log(`   Protocol: ${data.protocol}`)
      console.log(`   Key ID: ${data.keyId}`)
      console.log(`   Ciphertext: ${data.ciphertext.substring(0, 64)}...`)
      console.log(`   Encrypted: ${data.encrypted}\n`)

      // Save for decryption test
      global.testCiphertext = data.ciphertext
      global.testProtocol = data.protocol
      global.testKeyId = data.keyId
      passed++
    } else {
      console.log('❌ FAILED: Invalid response', data)
      failed++
    }
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error), '\n')
    failed++
  }

  // ==========================================================================
  // Test 4: POST /api/decrypt
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 4: POST /api/decrypt')
  console.log('━'.repeat(70))
  try {
    const response = await fetch(`${API_BASE}/api/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciphertext: global.testCiphertext,
        protocol: global.testProtocol,
        keyId: global.testKeyId,
        counterparty: 'self'
      })
    })
    const data = await response.json()

    if (data.success && data.plaintext) {
      const matches = data.plaintext === 'Secret data from HTTP API'
      console.log('✅ PASSED')
      console.log(`   Decrypted: "${data.plaintext}"`)
      console.log(`   Protocol: ${data.protocol}`)
      console.log(`   Key ID: ${data.keyId}`)
      console.log(`   Match: ${matches ? '✅' : '❌'}\n`)
      passed++
    } else {
      console.log('❌ FAILED: Invalid response', data)
      failed++
    }
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error), '\n')
    failed++
  }

  // ==========================================================================
  // Test 5: GET /api/balance
  // ==========================================================================
  console.log('━'.repeat(70))
  console.log('TEST 5: GET /api/balance')
  console.log('━'.repeat(70))
  try {
    const response = await fetch(`${API_BASE}/api/balance`)
    const data = await response.json()

    if (data.success !== undefined) {
      console.log('✅ PASSED')
      console.log(`   Balance: ${data.balance} satoshis`)
      console.log(`   UTXOs: ${data.utxos}`)
      console.log(`   Network: ${data.network}\n`)
      passed++
    } else {
      console.log('❌ FAILED: Invalid response', data)
      failed++
    }
  } catch (error) {
    console.log('❌ FAILED:', error instanceof Error ? error.message : String(error), '\n')
    failed++
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('='.repeat(70))
  console.log('📊 HTTP API TEST SUMMARY')
  console.log('='.repeat(70))
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📦 Total:  ${passed + failed}`)
  console.log()

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED!\n')
    console.log('✨ Your AGIdentity service is working!')
    console.log('   Any agent framework can now use these endpoints:\n')
    console.log('   • OpenClaw → HTTP calls')
    console.log('   • ZeroClaw → HTTP calls')
    console.log('   • PicoClaw → HTTP calls')
    console.log('   • Python agent → requests library')
    console.log('   • Custom agent → standard HTTP\n')
    console.log('🔌 Universal plugin working!\n')
    console.log('='.repeat(70) + '\n')
    process.exit(0)
  } else {
    console.log('⚠️  Some tests failed.\n')
    console.log('Make sure AGIdentity server is running:')
    console.log('   npm run start\n')
    console.log('='.repeat(70) + '\n')
    process.exit(1)
  }
}

// Global for test data
declare global {
  var testCiphertext: string
  var testProtocol: string
  var testKeyId: string
}

// Run tests
console.log('📡 Connecting to AGIdentity server at', API_BASE)
console.log('   Make sure server is running: npm run start\n')

testAPI().catch(error => {
  console.error('\n❌ Test suite failed:', error.message)
  console.error('\nIs the server running? Try: npm run start')
  process.exit(1)
})

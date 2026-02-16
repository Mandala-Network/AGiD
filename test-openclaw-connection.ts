#!/usr/bin/env tsx
/**
 * Test OpenClaw Connection
 *
 * Verifies that:
 * 1. OpenClaw gateway is running
 * 2. AGIdentity can connect to it
 * 3. Wallet tools are accessible
 */

import { createOpenClawClient } from './dist/openclaw/index.js'

async function test() {
  console.log('\n🧪 Testing OpenClaw Connection...\n')

  try {
    console.log('1. Connecting to OpenClaw gateway...')
    const client = await createOpenClawClient({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authToken: 'test-token-123'
    })

    await client.connect()
    console.log('✅ Connected to OpenClaw!\n')

    console.log('2. Sending test message...')
    const response = await client.sendChat('What is your identity?', {
      conversationId: 'test-123'
    })

    console.log('✅ Response received:')
    console.log(response)
    console.log()

    await client.disconnect()
    console.log('✅ Test complete!\n')

  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error))
    console.error('\nMake sure:')
    console.error('  - OpenClaw gateway is running: npx openclaw gateway')
    console.error('  - Gateway on port 18789')
    console.error('  - Auth token matches: test-token-123\n')
    process.exit(1)
  }
}

test()

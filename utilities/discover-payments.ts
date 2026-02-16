#!/usr/bin/env tsx
/**
 * Discover MessageBox Payments Without Anointing
 *
 * Uses listMessages() to find incoming payments and internalize them
 * into the MPC wallet WITHOUT calling init() which tries to anoint.
 */

import 'dotenv/config'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'
import { MessageBoxClient } from './message-box-client/dist/esm/src/MessageBoxClient.js'

async function discoverPayments() {
  console.log('\n💰 Discovering MessageBox Payments (MPC-Aware)\n')

  // Initialize MPC wallet
  console.log('1. Initializing MPC wallet...')
  const mpcConfig = loadMPCConfigFromEnv()
  const result = await createProductionMPCWallet(mpcConfig)
  const wallet = result.wallet
  const publicKey = result.collectivePublicKey

  console.log(`   ✅ MPC Wallet: ${publicKey}`)
  console.log(`   Network: mainnet\n`)

  // Check current balance
  console.log('2. Current balance...')
  try {
    const underlyingWallet = (wallet as any).wallet || wallet
    const balance = await underlyingWallet.getBalance()
    console.log(`   Balance: ${balance} satoshis\n`)
  } catch (error) {
    console.log(`   (Balance check failed, continuing...)\n`)
  }

  // Create MessageBox client WITHOUT calling init()
  console.log('3. Creating MessageBox client (no anointment)...')
  const underlyingWallet = (wallet as any).wallet || wallet

  const messageBoxClient = new MessageBoxClient({
    host: process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems',
    walletClient: underlyingWallet,
    enableLogging: true,
    networkPreset: 'mainnet'
  } as any)

  console.log('   ✅ Client created (not initialized)\n')

  // List messages WITHOUT init (this should work and discover payments)
  console.log('4. Querying MessageBox for incoming messages...')
  console.log(`   Checking inbox for: ${publicKey}\n`)

  try {
    // Query common message boxes
    const inboxes = ['inbox', 'notifications', 'payments']

    for (const box of inboxes) {
      console.log(`   Checking ${box}...`)
      try {
        const messages = await messageBoxClient.listMessages({
          messageBox: box,
          acceptPayments: true  // Auto-accept and internalize payments!
        })

        console.log(`   ✅ Found ${messages.length} messages in ${box}`)

        for (const msg of messages) {
          console.log(`      - From: ${msg.sender.substring(0, 16)}...`)
          console.log(`        Body: ${typeof msg.body === 'string' ? msg.body.substring(0, 50) : JSON.stringify(msg.body).substring(0, 50)}`)
          if (msg.payment) {
            console.log(`        💰 Payment included!`)
          }
        }
        console.log()
      } catch (error) {
        console.log(`      No messages in ${box}`)
      }
    }

    // Check balance again after message discovery
    console.log('5. Checking balance after discovery...')
    try {
      const balance = await underlyingWallet.getBalance()
      console.log(`   ✅ New Balance: ${balance} satoshis\n`)

      if (balance > 0) {
        console.log('🎉 SUCCESS! Payments discovered and internalized!')
        console.log('   MessageBox can now initialize.')
        console.log('   Restart gateway: npm run gateway\n')
      } else {
        console.log('⚠️  Balance still 0.')
        console.log('   Payments might not have been in the messages.')
        console.log('   Or they need to be manually internalized.\n')
      }
    } catch (error) {
      console.log(`   (Balance check failed)\n`)
    }

  } catch (error) {
    console.error('❌ Discovery failed:', error instanceof Error ? error.message : String(error))
    console.error('\nThis might mean:')
    console.error('   - No messages waiting')
    console.error('   - Different MessageBox host')
    console.error('   - Authentication issue\n')
  }
}

discoverPayments().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  console.error(error.stack)
  process.exit(1)
})

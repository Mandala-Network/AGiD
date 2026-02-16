#!/usr/bin/env tsx
/**
 * Internalize MessageBox Funding
 *
 * When funds are sent via MessageBox/PeerPay, the wallet doesn't know about
 * them until MessageBox client connects. But MessageBox needs funds to connect!
 *
 * This script:
 * 1. Connects to MessageBox manually
 * 2. Finds incoming transactions
 * 3. Internalizes BEEF into MPC wallet
 * 4. Wallet now has balance
 * 5. MessageBox gateway can then initialize
 */

import 'dotenv/config'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'
import { MessageBoxClient } from '@bsv/message-box-client'

async function internalizeFunding() {
  console.log('\n🔄 Internalizing MessageBox Funding into MPC Wallet\n')

  // Initialize MPC wallet
  console.log('1. Initializing MPC wallet...')
  const mpcConfig = loadMPCConfigFromEnv()
  const result = await createProductionMPCWallet(mpcConfig)
  const wallet = result.wallet
  const publicKey = result.collectivePublicKey

  console.log(`   ✅ MPC Wallet: ${publicKey}\n`)

  // Get underlying wallet for MessageBox
  const underlyingWallet = (wallet as any).wallet || wallet

  // Initialize MessageBox client WITHOUT anointHost
  console.log('2. Connecting to MessageBox...')
  const messageBox = new MessageBoxClient({
    wallet: underlyingWallet,
    host: process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems',
    skipAnointment: true  // Skip the funding requirement
  })

  try {
    await messageBox.init()
    console.log('   ✅ MessageBox connected\n')

    // List incoming messages/transactions
    console.log('3. Searching for incoming transactions...')
    const messages = await messageBox.listMessages()

    console.log(`   Found ${messages.length} messages\n`)

    if (messages.length === 0) {
      console.log('   ⚠️  No messages found. Funds might not have arrived yet.')
      console.log('   Or they might be in a different format.\n')
      return
    }

    // Process each message to internalize UTXOs
    console.log('4. Internalizing transactions...')
    for (const message of messages) {
      console.log(`   Processing message ID: ${message.messageId}`)

      // If message has BEEF/transaction data, internalize it
      if (message.beef) {
        try {
          // Import the BEEF into the wallet
          await wallet.ingestTransaction(message.beef)
          console.log(`   ✅ Internalized transaction from message ${message.messageId}`)
        } catch (error) {
          console.log(`   ⚠️  Could not internalize: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    console.log()

    // Check balance after internalization
    console.log('5. Checking new balance...')
    const balance = await wallet.getBalanceAndUtxos()

    console.log(`   ✅ Balance: ${balance.total} satoshis`)
    console.log(`   ✅ UTXOs: ${balance.utxos?.length || 0}\n`)

    if (balance.total > 0) {
      console.log('🎉 SUCCESS! Wallet now has funds!')
      console.log('   MessageBox gateway should now be able to initialize.\n')
      console.log('Next step:')
      console.log('   Restart gateway: npm run gateway\n')
    } else {
      console.log('⚠️  Balance still 0. Possible issues:')
      console.log('   - Funds sent to different address')
      console.log('   - Transaction format not recognized')
      console.log('   - Network mismatch\n')
      console.log('Your MPC wallet address:')
      console.log(`   ${publicKey}\n`)
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    console.error('\nThis might be expected if MessageBox requires anointed host.')
    console.error('Try checking balance directly via blockchain explorer.\n')
  }
}

internalizeFunding().catch(error => {
  console.error('\n❌ Failed:', error.message)
  process.exit(1)
})

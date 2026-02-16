#!/usr/bin/env tsx
/**
 * Discover and Internalize MessageBox Payments
 *
 * Query MessageBox API directly for incoming payments,
 * then internalize the BEEFs into the MPC wallet.
 */

import 'dotenv/config'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'

async function discoverPayments() {
  console.log('\n💰 Discovering MessageBox Payments\n')

  // Initialize MPC wallet
  console.log('1. Initializing MPC wallet...')
  const mpcConfig = loadMPCConfigFromEnv()
  const result = await createProductionMPCWallet(mpcConfig)
  const wallet = result.wallet
  const publicKey = result.collectivePublicKey

  console.log(`   ✅ Wallet: ${publicKey}`)
  console.log(`   Network: ${process.env.AGID_NETWORK}\n`)

  // Check current balance
  console.log('2. Current balance...')
  const balance = await wallet.getBalanceAndUtxos()
  console.log(`   Balance: ${balance.total} satoshis`)
  console.log(`   UTXOs: ${balance.utxos?.length || 0}\n`)

  // Query MessageBox API directly for incoming transactions
  console.log('3. Querying MessageBox for incoming transactions...')
  console.log(`   Host: ${process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems'}`)
  console.log(`   Recipient: ${publicKey}\n`)

  try {
    // Direct HTTP query to MessageBox overlay service
    const messageBoxHost = process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems'

    // Query for transactions to this identity
    const url = `${messageBoxHost}/lookup`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tm_messagebox',
        query: {
          recipient: publicKey
        }
      })
    })

    if (!response.ok) {
      console.log(`   ⚠️  MessageBox query failed: ${response.status} ${response.statusText}`)
      console.log('   Funds might not be visible via overlay lookup yet.\n')
      return
    }

    const data = await response.json()
    console.log('   Response:', JSON.stringify(data, null, 2))
    console.log()

    // Check if there are any UTXOs/transactions to internalize
    if (data.outputs && data.outputs.length > 0) {
      console.log(`4. Found ${data.outputs.length} outputs!`)
      console.log('   Internalizing into wallet...\n')

      for (const output of data.outputs) {
        try {
          console.log(`   Processing output: ${output.txid}.${output.vout}`)

          // If BEEF is provided, internalize it
          if (output.beef) {
            await (wallet as any).ingestTransaction(output.beef)
            console.log(`   ✅ Internalized`)
          }
        } catch (error) {
          console.log(`   ⚠️  Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Check balance again
      console.log()
      console.log('5. New balance...')
      const newBalance = await wallet.getBalanceAndUtxos()
      console.log(`   ✅ Balance: ${newBalance.total} satoshis`)
      console.log(`   ✅ UTXOs: ${newBalance.utxos?.length || 0}`)

      if (newBalance.total > balance.total) {
        console.log()
        console.log('🎉 SUCCESS! Funds internalized!')
        console.log('   MessageBox gateway should now work.')
        console.log('   Restart: npm run gateway\n')
      }
    } else {
      console.log('   No outputs found in MessageBox lookup.\n')
      console.log('Possible reasons:')
      console.log('   - Funds not yet broadcast')
      console.log('   - Sent to different address')
      console.log('   - Different lookup method needed\n')
    }

  } catch (error) {
    console.error('❌ Lookup failed:', error instanceof Error ? error.message : String(error))
    console.error('\nYou may need to manually provide the BEEF/transaction.\n')
  }
}

discoverPayments().catch(error => {
  console.error('\n❌ Failed:', error.message)
  process.exit(1)
})

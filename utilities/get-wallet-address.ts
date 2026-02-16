#!/usr/bin/env tsx
/**
 * Get MPC Wallet Address for Funding
 */

import 'dotenv/config'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'

async function getAddress() {
  console.log('\n🔐 Getting MPC Wallet Address...\n')

  const mpcConfig = loadMPCConfigFromEnv()
  const result = await createProductionMPCWallet(mpcConfig)

  const identity = await result.wallet.getPublicKey({ identityKey: true })

  console.log('✅ MPC Wallet Ready')
  console.log(`   Collective Public Key: ${result.collectivePublicKey}`)
  console.log(`   Identity Key: ${identity.publicKey}`)
  console.log(`   Network: mainnet`)
  console.log()
  console.log('📬 FUND THIS ADDRESS:')
  console.log(`   ${identity.publicKey}`)
  console.log()
  console.log('💰 Send BSV via MessageBox to this public key')
  console.log('   The agent will be able to:')
  console.log('   • Send/receive MessageBox messages')
  console.log('   • Create memory tokens on blockchain')
  console.log('   • Sign transactions')
  console.log('   • Full autonomous operation')
  console.log()
}

getAddress().catch(console.error)

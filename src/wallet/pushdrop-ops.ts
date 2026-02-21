/**
 * PushDrop Token Operations
 *
 * Lock (create), unlock (redeem), and decode PushDrop tokens (BRC-48).
 * Works with AgentWallet (wallet-toolbox).
 *
 * PushDrop tokens store arbitrary data fields in a locking script,
 * signed by the wallet's derived key. They're stored in wallet baskets
 * for retrieval and can be redeemed (spent) to reclaim the satoshis.
 */

import { PushDrop, Utils, LockingScript, Beef } from '@bsv/sdk'
import type { BRC100Wallet } from '../types/index.js'

// ============================================================================
// Types
// ============================================================================

export interface LockTokenParams {
  fields: string[]
  protocolID: [number, string]
  keyID: string
  counterparty?: string
  satoshis?: number
  basket?: string
  description?: string
}

export interface LockTokenResult {
  txid: string
  vout: number
  lockingScript: string
  satoshis: number
}

export interface UnlockTokenParams {
  txid: string
  vout: number
  protocolID: [number, string]
  keyID: string
  counterparty?: string
  description?: string
}

export interface UnlockTokenResult {
  txid: string
  satoshis: number
}

export interface DecodedToken {
  fields: string[]
  lockPosition: 'before' | 'after'
}

// ============================================================================
// Lock (Create Token)
// ============================================================================

/**
 * Create a PushDrop token with data fields locked to the wallet's key.
 *
 * PushDrop.lock() internally calls wallet.getPublicKey() and
 * wallet.createSignature().
 *
 * @param wallet - BRC-100 compatible wallet (AgentWallet)
 * @param params - Token parameters (fields, protocol, basket, etc.)
 * @returns Lock result with txid, vout, and locking script hex
 */
export async function lockPushDropToken(
  wallet: BRC100Wallet,
  params: LockTokenParams
): Promise<LockTokenResult> {
  const {
    fields,
    protocolID,
    keyID,
    counterparty = 'self',
    satoshis = 1,
    basket = 'tokens',
    description = 'Create PushDrop token',
  } = params

  // Convert string fields to byte arrays
  const fieldArrays: number[][] = fields.map((f) => Utils.toArray(f, 'utf8'))

  // PushDrop constructor accepts any wallet-like object with
  // getPublicKey() and createSignature() - both BRC-100 methods
  const pushDrop = new PushDrop(wallet.asWalletInterface())

  const lockingScript = await pushDrop.lock(
    fieldArrays,
    protocolID as [0 | 1 | 2, string],
    keyID,
    counterparty,
    true, // forSelf
    true  // includeSignature
  )

  const lockingScriptHex = lockingScript.toHex()

  // Create transaction with token output stored in basket
  const result = await wallet.createAction({
    description,
    outputs: [
      {
        script: lockingScriptHex,
        satoshis,
        description: 'PushDrop token output',
        basket,
        tags: ['pushdrop', `proto:${protocolID[1]}`],
      },
    ],
    options: {
      acceptDelayedBroadcast: false,
      randomizeOutputs: false,
    },
  })

  if (!result.txid) {
    throw new Error('PushDrop lock failed: no txid returned from createAction')
  }

  return {
    txid: result.txid,
    vout: 0,
    lockingScript: lockingScriptHex,
    satoshis,
  }
}

// ============================================================================
// Unlock (Redeem Token)
// ============================================================================

/**
 * Redeem (spend) a PushDrop token, reclaiming the satoshis.
 *
 * This requires the underlying wallet (not BRC100Wallet) because the unlock
 * flow may return a signableTransaction that needs BEEF parsing and signAction().
 * Pass wallet.getUnderlyingWallet().
 *
 * @param wallet - The underlying wallet instance (Wallet)
 * @param params - Unlock parameters (txid, vout, protocol params)
 * @returns Unlock result with new txid
 */
export async function unlockPushDropToken(
  wallet: any,
  params: UnlockTokenParams
): Promise<UnlockTokenResult> {
  const {
    txid,
    vout,
    protocolID,
    keyID,
    counterparty = 'self',
    description = 'Redeem PushDrop token',
  } = params

  const pushDrop = new PushDrop(wallet)
  const unlockTemplate = pushDrop.unlock(protocolID as [0 | 1 | 2, string], keyID, counterparty)
  const estimatedLength = await unlockTemplate.estimateLength()

  // Resolve inputBEEF from wallet storage
  let inputBEEF: number[] | undefined
  try {
    const storageManager = wallet.storage
    if (storageManager) {
      const storageProvider = storageManager.getActiveProvider()
      if (storageProvider) {
        const beefResult = await storageProvider.getBeefForTransaction(txid, {})
        inputBEEF = beefResult.toBinary()
      }
    }
  } catch {
    // inputBEEF resolution is optional - createAction may handle it
  }

  // Create spending action
  const createActionArgs: any = {
    description,
    inputs: [
      {
        outpoint: `${txid}.${vout}`,
        inputDescription: 'Spend PushDrop token',
        unlockingScriptLength: estimatedLength,
      },
    ],
    options: {
      acceptDelayedBroadcast: false,
      trustSelf: 'known',
      randomizeOutputs: false,
    },
  }

  if (inputBEEF) {
    createActionArgs.inputBEEF = inputBEEF
  }

  const result = await wallet.createAction(createActionArgs)

  // Handle signableTransaction flow (wallet returns unsigned tx for us to sign)
  if (result.signableTransaction) {
    const beef = Beef.fromBinary(result.signableTransaction.tx)
    const atomicTxid = beef.atomicTxid
    if (!atomicTxid) {
      throw new Error('PushDrop unlock failed: no atomic txid in signable BEEF')
    }

    const btx = beef.findTxid(atomicTxid)
    if (!btx || !btx.tx) {
      throw new Error('PushDrop unlock failed: transaction not found in BEEF')
    }

    const tx = btx.tx

    // Attach source transactions for each input
    for (const input of tx.inputs) {
      const sourceTxid = input.sourceTXID
      if (sourceTxid && !input.sourceTransaction) {
        const sourceBtx = beef.findTxid(sourceTxid)
        if (sourceBtx && sourceBtx.tx) {
          input.sourceTransaction = sourceBtx.tx
        }
      }
    }

    // Find our token input
    let tokenInputIndex = -1
    for (let i = 0; i < tx.inputs.length; i++) {
      const inp = tx.inputs[i]
      const inputTxid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
      if (inputTxid === txid && inp.sourceOutputIndex === vout) {
        tokenInputIndex = i
        break
      }
    }

    if (tokenInputIndex < 0) {
      throw new Error('PushDrop unlock failed: token input not found in transaction')
    }

    // Sign with PushDrop template
    const unlockingScript = await unlockTemplate.sign(tx, tokenInputIndex)
    tx.inputs[tokenInputIndex].unlockingScript = unlockingScript

    // Complete signing via signAction
    const signResult = await wallet.signAction({
      reference: result.signableTransaction.reference,
      spends: {
        [tokenInputIndex]: {
          unlockingScript: unlockingScript.toHex(),
        },
      },
    })

    if (!signResult.txid) {
      throw new Error('PushDrop unlock failed: no txid returned from signAction')
    }

    return { txid: signResult.txid, satoshis: 1 }
  }

  // Direct completion (createAction returned txid)
  if (!result.txid) {
    throw new Error('PushDrop unlock failed: no txid or signableTransaction returned')
  }

  return { txid: result.txid, satoshis: 1 }
}

// ============================================================================
// Decode (Read Token Fields)
// ============================================================================

/**
 * Decode the data fields from a PushDrop locking script.
 *
 * @param lockingScriptHex - Hex-encoded locking script
 * @param lockPosition - Where the lock is relative to the data ('before' or 'after')
 * @returns Decoded field strings
 */
export function decodePushDropToken(
  lockingScriptHex: string,
  lockPosition: 'before' | 'after' = 'before'
): DecodedToken {
  const script = LockingScript.fromHex(lockingScriptHex)
  const decoded = PushDrop.decode(script, lockPosition)

  const fields = decoded.fields.map((fieldBytes: number[]) =>
    new TextDecoder().decode(new Uint8Array(fieldBytes))
  )

  return { fields, lockPosition }
}

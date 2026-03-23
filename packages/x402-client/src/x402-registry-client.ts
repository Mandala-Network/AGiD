/**
 * x402 Registry Client
 *
 * Register, update, remove, and discover x402 paid services on the overlay.
 * Uses WalletClient + PushDrop for token creation and TopicBroadcaster
 * for overlay submission.
 *
 * Usage:
 *   const client = new X402RegistryClient()
 *   await client.register({ hostUrl: 'https://...', category: 'ai', pricing: {...}, capabilities: [...] })
 *   const services = await client.discover({ category: 'ai' })
 */

import {
  WalletClient,
  PushDrop,
  TopicBroadcaster,
  LookupResolver,
  Transaction,
  Utils,
} from '@bsv/sdk'

import {
  X402_PROTOCOL_ID,
  X402_TOPIC,
  X402_LOOKUP,
  X402_PROTOCOL,
  X402_KEY_ID,
  X402_BASKET,
  type RegistrationParams,
  type RegistrationResult,
  type DiscoveredService,
  type DiscoverOptions,
  type PricingInfo,
} from './types.js'

export class X402RegistryClient {
  private wallet: WalletClient
  private broadcaster: TopicBroadcaster
  private resolver: LookupResolver

  constructor(wallet?: WalletClient) {
    this.wallet = wallet ?? new WalletClient()
    this.broadcaster = new TopicBroadcaster([X402_TOPIC])
    this.resolver = new LookupResolver()
  }

  /**
   * Register a new x402 service on the overlay.
   *
   * Creates a PushDrop token with the 5-field registration format
   * and broadcasts it to the tm_x402 topic.
   */
  async register(params: RegistrationParams): Promise<RegistrationResult> {
    // Validate
    if (!params.hostUrl.startsWith('https://')) {
      throw new Error('hostUrl must start with https://')
    }
    if (!params.category || params.category.length > 50) {
      throw new Error('category is required and must be <= 50 characters')
    }
    if (!params.pricing?.currency) {
      throw new Error('pricing.currency is required')
    }
    if (!Array.isArray(params.capabilities)) {
      throw new Error('capabilities must be an array of strings')
    }

    // Build the 5 token fields
    const fields = [
      X402_PROTOCOL_ID,
      params.hostUrl,
      params.category,
      JSON.stringify(params.pricing),
      JSON.stringify(params.capabilities),
    ]

    // Create PushDrop locking script
    const pushDrop = new PushDrop(this.wallet)
    const lockingScript = await pushDrop.lock(
      fields.map(f => Utils.toArray(f, 'utf8')),
      X402_PROTOCOL,
      X402_KEY_ID,
      'self',
      true,  // forSelf
      true,  // includeSignature
    )

    // Create transaction with the token output
    const createResult = await this.wallet.createAction({
      description: `Register x402 service: ${params.hostUrl}`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        outputDescription: 'x402 registration token',
        basket: X402_BASKET,
        tags: ['x402', 'registration', params.category],
      }],
      options: {
        acceptDelayedBroadcast: false,
        randomizeOutputs: false,
      },
    })

    if (!createResult.tx) {
      throw new Error('createAction did not return a transaction')
    }

    // Broadcast to the x402 overlay topic
    await this.broadcaster.broadcast(createResult.tx)

    // Get identity key
    const { publicKey } = await this.wallet.getPublicKey({ identityKey: true })

    return {
      txid: createResult.txid!,
      outputIndex: 0,
      identityKey: publicKey,
    }
  }

  /**
   * Update an existing registration by spending the old token
   * and creating a new one in a single atomic action.
   */
  async update(
    existingTxid: string,
    existingOutputIndex: number,
    params: RegistrationParams,
  ): Promise<RegistrationResult> {
    // Build new token fields
    const fields = [
      X402_PROTOCOL_ID,
      params.hostUrl,
      params.category,
      JSON.stringify(params.pricing),
      JSON.stringify(params.capabilities),
    ]

    // Create new locking script
    const pushDrop = new PushDrop(this.wallet)
    const lockingScript = await pushDrop.lock(
      fields.map(f => Utils.toArray(f, 'utf8')),
      X402_PROTOCOL,
      X402_KEY_ID,
      'self',
      true,
      true,
    )

    // Create unlock template for the old token
    const unlockTemplate = pushDrop.unlock(X402_PROTOCOL, X402_KEY_ID, 'self')
    const estimatedLength = await unlockTemplate.estimateLength()

    // Atomic action: spend old + create new
    const createResult = await this.wallet.createAction({
      description: `Update x402 service: ${params.hostUrl}`,
      inputs: [{
        outpoint: `${existingTxid}.${existingOutputIndex}`,
        inputDescription: 'Spend old registration',
        unlockingScriptLength: estimatedLength,
      }],
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        outputDescription: 'Updated x402 registration token',
        basket: X402_BASKET,
        tags: ['x402', 'registration', params.category],
      }],
      options: {
        acceptDelayedBroadcast: false,
        randomizeOutputs: false,
      },
    })

    // Handle signable transaction flow
    if (createResult.signableTransaction) {
      const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

      // Find and sign the input spending the old token
      for (let i = 0; i < tx.inputs.length; i++) {
        const inp = tx.inputs[i]
        const inputTxid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
        if (inputTxid === existingTxid && inp.sourceOutputIndex === existingOutputIndex) {
          const unlockingScript = await unlockTemplate.sign(tx, i)
          tx.inputs[i].unlockingScript = unlockingScript

          const signResult = await this.wallet.signAction({
            reference: createResult.signableTransaction.reference,
            spends: {
              [i]: { unlockingScript: unlockingScript.toHex() },
            },
          })

          if (signResult.tx) {
            await this.broadcaster.broadcast(signResult.tx)
          }

          const { publicKey } = await this.wallet.getPublicKey({ identityKey: true })
          return {
            txid: signResult.txid!,
            outputIndex: 0,
            identityKey: publicKey,
          }
        }
      }

      throw new Error('Could not find old registration input in signable transaction')
    }

    if (createResult.tx) {
      await this.broadcaster.broadcast(createResult.tx)
    }

    const { publicKey } = await this.wallet.getPublicKey({ identityKey: true })
    return {
      txid: createResult.txid!,
      outputIndex: 0,
      identityKey: publicKey,
    }
  }

  /**
   * Remove a registration by spending its UTXO.
   * The overlay removes the listing when the output is spent.
   */
  async remove(txid: string, outputIndex: number): Promise<string> {
    const pushDrop = new PushDrop(this.wallet)
    const unlockTemplate = pushDrop.unlock(X402_PROTOCOL, X402_KEY_ID, 'self')
    const estimatedLength = await unlockTemplate.estimateLength()

    const createResult = await this.wallet.createAction({
      description: 'Remove x402 service registration',
      inputs: [{
        outpoint: `${txid}.${outputIndex}`,
        inputDescription: 'Spend registration token',
        unlockingScriptLength: estimatedLength,
      }],
      options: {
        acceptDelayedBroadcast: false,
      },
    })

    if (createResult.signableTransaction) {
      const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

      for (let i = 0; i < tx.inputs.length; i++) {
        const inp = tx.inputs[i]
        const inputTxid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
        if (inputTxid === txid && inp.sourceOutputIndex === outputIndex) {
          const unlockingScript = await unlockTemplate.sign(tx, i)
          tx.inputs[i].unlockingScript = unlockingScript

          const signResult = await this.wallet.signAction({
            reference: createResult.signableTransaction.reference,
            spends: {
              [i]: { unlockingScript: unlockingScript.toHex() },
            },
          })

          if (signResult.tx) {
            await this.broadcaster.broadcast(signResult.tx)
          }

          return signResult.txid!
        }
      }

      throw new Error('Could not find registration input in signable transaction')
    }

    if (createResult.tx) {
      await this.broadcaster.broadcast(createResult.tx)
    }

    return createResult.txid!
  }

  /**
   * Discover x402 services from the overlay.
   *
   * Queries ls_x402 and decodes the PushDrop fields from returned UTXOs.
   */
  async discover(options: DiscoverOptions = {}): Promise<DiscoveredService[]> {
    const query: Record<string, unknown> = {}
    if (options.category) query.category = options.category
    if (options.capability) query.capability = options.capability
    if (options.hostUrl) query.hostUrl = options.hostUrl
    if (options.identityKey) query.identityKey = options.identityKey
    if (options.maxDefaultPrice !== undefined) query.maxDefaultPrice = options.maxDefaultPrice

    const answer = await this.resolver.query({
      service: X402_LOOKUP,
      query,
    })

    if (answer.type !== 'output-list') return []

    const services: DiscoveredService[] = []

    for (const output of answer.outputs) {
      try {
        const tx = Transaction.fromBEEF(output.beef)
        const script = tx.outputs[output.outputIndex]?.lockingScript
        if (!script) continue

        const decoded = PushDrop.decode(script)
        if (!decoded?.fields || decoded.fields.length < 5) continue

        const fields = decoded.fields.map((f: number[]) =>
          Utils.toUTF8(f),
        )

        if (fields[0] !== X402_PROTOCOL_ID) continue

        let pricing: PricingInfo
        try { pricing = JSON.parse(fields[3]) } catch { continue }

        let capabilities: string[]
        try { capabilities = JSON.parse(fields[4]) } catch { continue }

        services.push({
          hostUrl: fields[1],
          category: fields[2],
          pricing,
          capabilities,
          identityKey: decoded.lockingPublicKey?.toString() ?? '',
          txid: tx.id('hex'),
          outputIndex: output.outputIndex,
        })
      } catch {
        continue
      }
    }

    return services
  }

  /**
   * Fetch extended service info from the host's /.well-known/x402-info endpoint.
   * Returns name, description, docs URL, contact, etc. — the metadata not stored on-chain.
   */
  async fetchServiceInfo(hostUrl: string): Promise<Record<string, unknown>> {
    const url = `${hostUrl.replace(/\/$/, '')}/.well-known/x402-info`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch service info: ${response.status}`)
    }
    return response.json() as Promise<Record<string, unknown>>
  }
}

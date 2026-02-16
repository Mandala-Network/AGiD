/**
 * PushDrop Routes for Onchain Memory
 *
 * Public endpoints for creating blockchain memory tokens
 */

import type { Request, Response } from 'express'
import { PushDrop, Utils } from '@bsv/sdk'

export function addPushDropRoutes(app: any, wallet: any) {
  /**
   * POST /api/create-memory
   * Create an onchain memory token using PushDrop
   */
  app.post('/api/create-memory', async (req: Request, res: Response) => {
    try {
      const { content, tags } = req.body

      if (!content) {
        res.status(400).json({ success: false, error: 'Missing content parameter' })
        return
      }

      // Prepare fields for PushDrop token
      const fields = [
        content,
        JSON.stringify(tags || []),
        new Date().toISOString()
      ]

      const fieldArrays: number[][] = fields.map(f => Utils.toArray(f, 'utf8'))

      // Create PushDrop template
      const pushDrop = new PushDrop(wallet)

      // Generate locking script
      const lockingScript = await pushDrop.lock(
        fieldArrays,
        [2, 'agent memory'],
        `mem-${Date.now()}`,
        'self',
        true,
        true
      )

      const lockingScriptHex = lockingScript.toHex()

      // Create transaction
      const result = await wallet.createAction({
        description: 'Create onchain memory',
        outputs: [{
          lockingScript: lockingScriptHex,
          satoshis: 1,
          outputDescription: 'Memory token',
          basket: 'memories',
          customInstructions: JSON.stringify({
            type: 'memory',
            content: content.substring(0, 100),
            timestamp: new Date().toISOString()
          })
        }],
        options: {
          acceptDelayedBroadcast: false,
          randomizeOutputs: false
        }
      })

      res.json({
        success: true,
        txid: result.txid,
        vout: 0,
        content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        stored: true,
        blockchain: process.env.AGID_NETWORK || 'mainnet',
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
}

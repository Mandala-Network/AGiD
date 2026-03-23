/**
 * x402 Service Registry — Topic Manager
 *
 * Validates incoming registration transactions. Enforces the 5-field
 * x402-registry-v1 token format: protocol, hostUrl, category, pricing,
 * capabilities.
 *
 * Topic: tm_x402
 */

import type { TopicManager, AdmittanceInstructions } from '@bsv/overlay'
import { PushDrop } from '@bsv/sdk'
import type { Beef } from '@bsv/sdk'
import { X402_PROTOCOL_ID, FIELD, FIELD_COUNT } from './X402Types'

export class X402TopicManager implements TopicManager {

  async identifyAdmissibleOutputs(
    beef: Beef,
    previousCoinsToRetain: string[],
  ): Promise<AdmittanceInstructions> {
    try {
      const tx = (beef as any).tx ?? beef
      if (!tx.outputs || tx.outputs.length === 0) {
        return { admissibleOutputs: [], coinsToRetain: [] }
      }

      const admissibleOutputs: number[] = []

      for (let i = 0; i < tx.outputs.length; i++) {
        if (this.validateOutput(tx.outputs[i])) {
          admissibleOutputs.push(i)
        }
      }

      return { admissibleOutputs, coinsToRetain: [] }
    } catch (error) {
      console.error('[X402TopicManager] Error:', error)
      return { admissibleOutputs: [], coinsToRetain: [] }
    }
  }

  private validateOutput(output: any): boolean {
    try {
      const script = output.lockingScript ?? output.script
      if (!script) return false

      const decoded = PushDrop.decode(script)
      if (!decoded?.fields || decoded.fields.length < FIELD_COUNT) return false

      const fields = decoded.fields.map((f: number[]) =>
        Buffer.from(f).toString('utf8'),
      )

      // Field 0: protocol identifier
      if (fields[FIELD.PROTOCOL] !== X402_PROTOCOL_ID) return false

      // Field 1: hostUrl — HTTPS required
      if (!fields[FIELD.HOST_URL]?.startsWith('https://')) return false

      // Field 2: category — non-empty, max 50 chars
      const category = fields[FIELD.CATEGORY]
      if (!category || category.length === 0 || category.length > 50) return false

      // Field 3: pricing — valid JSON with currency
      try {
        const pricing = JSON.parse(fields[FIELD.PRICING])
        if (!pricing.currency || typeof pricing.currency !== 'string') return false
      } catch {
        return false
      }

      // Field 4: capabilities — valid JSON array of strings
      try {
        const caps = JSON.parse(fields[FIELD.CAPABILITIES])
        if (!Array.isArray(caps)) return false
        if (!caps.every((c: any) => typeof c === 'string')) return false
      } catch {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  getDocumentation(): string {
    return `# x402 Service Registry Topic Manager (tm_x402)

Validates x402 service registration tokens. Minimal 5-field format:

| Index | Field | Validation |
|-------|-------|------------|
| 0 | protocol | Must be "x402-registry-v1" |
| 1 | hostUrl | Must start with "https://" |
| 2 | category | Non-empty, max 50 chars |
| 3 | pricing | Valid JSON with currency field |
| 4 | capabilities | Valid JSON array of strings |

Operator identity is derived from the PushDrop locking key.
Registration time is derived from the block timestamp.
Service name/description/docs are fetched from the host at /.well-known/x402-info.
Spending a registration UTXO removes the service from the overlay.`
  }

  getMetaData(): object {
    return {
      name: 'x402 Service Registry Topic Manager',
      shortDescription: 'Validates x402 paid service registration tokens',
      version: '1.0.0',
    }
  }
}

export default X402TopicManager

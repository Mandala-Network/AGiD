/**
 * x402 Service Registry — Topic Manager
 *
 * Validates incoming registration transactions and determines which
 * outputs should be admitted to the overlay. Enforces the x402-registry-v1
 * protocol format, field constraints, and pricing schema validation.
 *
 * Topic: tm_x402
 */

import type { TopicManager, AdmittanceInstructions } from '@bsv/overlay'
import { PushDrop } from '@bsv/sdk'
import type { Beef } from '@bsv/sdk'
import { X402_PROTOCOL_ID, FIELD } from './X402Types'

export class X402TopicManager implements TopicManager {

  /**
   * Validate a transaction and return which outputs are admissible.
   */
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
        try {
          const output = tx.outputs[i]
          const script = output.lockingScript ?? output.script
          if (!script) continue

          // Decode PushDrop token
          const decoded = PushDrop.decode(script)
          if (!decoded || !decoded.fields || decoded.fields.length < 9) continue

          // Decode fields as UTF-8
          const fields = decoded.fields.map((f: number[]) =>
            Buffer.from(f).toString('utf8'),
          )

          // Validate protocol identifier
          if (fields[FIELD.PROTOCOL] !== X402_PROTOCOL_ID) continue

          // Validate hostUrl — must be HTTPS
          const hostUrl = fields[FIELD.HOST_URL]
          if (!hostUrl || !hostUrl.startsWith('https://')) continue

          // Validate name — non-empty, max 100 chars
          const name = fields[FIELD.NAME]
          if (!name || name.length === 0 || name.length > 100) continue

          // Validate description — max 500 chars
          const description = fields[FIELD.DESCRIPTION]
          if (description && description.length > 500) continue

          // Validate category — non-empty, max 50 chars
          const category = fields[FIELD.CATEGORY]
          if (!category || category.length === 0 || category.length > 50) continue

          // Validate pricing — must be valid JSON with currency field
          const pricingRaw = fields[FIELD.PRICING]
          if (!pricingRaw) continue
          let pricing: any
          try {
            pricing = JSON.parse(pricingRaw)
            if (!pricing.currency || typeof pricing.currency !== 'string') continue
          } catch {
            continue
          }

          // Validate capabilities — must be valid JSON array
          const capabilitiesRaw = fields[FIELD.CAPABILITIES]
          if (!capabilitiesRaw) continue
          try {
            const capabilities = JSON.parse(capabilitiesRaw)
            if (!Array.isArray(capabilities)) continue
            if (!capabilities.every((c: any) => typeof c === 'string')) continue
          } catch {
            continue
          }

          // Field 7 (contactUrl) is optional — no validation beyond string type

          // Validate registeredAt — must be parseable as a date
          const registeredAt = fields[FIELD.REGISTERED_AT]
          if (!registeredAt || isNaN(Date.parse(registeredAt))) continue

          // All validations passed — admit this output
          admissibleOutputs.push(i)
        } catch {
          // Skip outputs that fail to decode
          continue
        }
      }

      return {
        admissibleOutputs,
        coinsToRetain: [],
      }
    } catch (error) {
      console.error('[X402TopicManager] Error processing transaction:', error)
      return { admissibleOutputs: [], coinsToRetain: [] }
    }
  }

  getDocumentation(): string {
    return `# x402 Service Registry Topic Manager (tm_x402)

Validates x402 service registration tokens. Each token contains:

| Index | Field | Validation |
|-------|-------|------------|
| 0 | protocol | Must be "x402-registry-v1" |
| 1 | hostUrl | Must be valid HTTPS URL |
| 2 | name | Non-empty, max 100 chars |
| 3 | description | Max 500 chars |
| 4 | category | Non-empty, max 50 chars |
| 5 | pricing | Valid JSON with currency field |
| 6 | capabilities | Valid JSON array of strings |
| 7 | contactUrl | Optional |
| 8 | registeredAt | Valid ISO 8601 timestamp |

Tokens are PushDrop-encoded with protocol [1, "x402-registry"].
Spending a registration UTXO removes the service from the overlay.`
  }

  getMetaData(): object {
    return {
      name: 'x402 Service Registry Topic Manager',
      shortDescription: 'Validates x402 paid service registration tokens',
      iconURL: '',
      version: '1.0.0',
      informationURL: '',
    }
  }
}

export default X402TopicManager

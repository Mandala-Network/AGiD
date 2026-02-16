/**
 * MPCAgentWallet Tests
 *
 * Tests the MPC wallet interface implementation with mock MPC wallet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MPCAgentWallet, createMPCAgentWallet, type IMPCWallet } from './mpc-agent-wallet.js'

/**
 * Create a mock MPC wallet for testing
 */
function createMockMPCWallet(): IMPCWallet {
  const mockPublicKey = '02' + '1'.repeat(64) // Valid compressed public key format

  return {
    getPublicKey: vi.fn().mockResolvedValue({ publicKey: mockPublicKey }),
    encrypt: vi.fn().mockResolvedValue({ ciphertext: [1, 2, 3, 4] }),
    decrypt: vi.fn().mockResolvedValue({ plaintext: [5, 6, 7, 8] }),
    createSignature: vi.fn().mockResolvedValue({ signature: [9, 10, 11, 12] }),
    verifySignature: vi.fn().mockResolvedValue({ valid: true }),
    createHmac: vi.fn().mockResolvedValue({ hmac: [13, 14, 15, 16] }),
    verifyHmac: vi.fn().mockResolvedValue({ valid: true }),
    createAction: vi.fn().mockResolvedValue({ txid: 'mock-txid-123' }),
    acquireCertificate: vi.fn().mockResolvedValue({
      type: 'employee',
      serialNumber: 'SN-001',
      subject: mockPublicKey,
      certifier: mockPublicKey,
      revocationOutpoint: 'abc:0',
      fields: { name: 'Test' },
      signature: 'mock-sig',
    }),
    listCertificates: vi.fn().mockResolvedValue({ certificates: [] }),
    getHeight: vi.fn().mockResolvedValue({ height: 850000 }),
    destroy: vi.fn().mockResolvedValue(undefined),
  }
}

describe('MPCAgentWallet', () => {
  let mockMPCWallet: IMPCWallet
  let wallet: MPCAgentWallet

  beforeEach(async () => {
    mockMPCWallet = createMockMPCWallet()
    wallet = new MPCAgentWallet({
      walletId: 'test-wallet',
      cosignerEndpoints: ['http://localhost:8081', 'http://localhost:8082'],
      shareSecret: 'test-secret',
      jwtSecret: 'test-jwt-secret',
      network: 'testnet',
      mpcWallet: mockMPCWallet, // Inject mock
    })
    await wallet.initialize()
  })

  describe('initialization', () => {
    it('should initialize with injected MPC wallet', async () => {
      expect(wallet.isInitialized()).toBe(true)
      expect(await wallet.isAuthenticated()).toBe(true)
    })

    it('should get identity key from injected wallet', async () => {
      const result = await wallet.getPublicKey({ identityKey: true })
      expect(result.publicKey).toBe('02' + '1'.repeat(64))
      expect(mockMPCWallet.getPublicKey).toHaveBeenCalledWith({ identityKey: true })
    })

    it('should throw helpful error when no MPC implementation provided', async () => {
      const walletWithoutMPC = new MPCAgentWallet({
        walletId: 'test-wallet',
        cosignerEndpoints: ['http://localhost:8081'],
        shareSecret: 'test-secret',
        jwtSecret: 'test-jwt-secret',
      })

      await expect(walletWithoutMPC.initialize()).rejects.toThrow(
        'MPC implementation not available'
      )
    })

    it('should return correct network', async () => {
      expect(await wallet.getNetwork()).toBe('testnet')
    })

    it('should return collective public key', () => {
      expect(wallet.getCollectivePublicKey()).toBe('02' + '1'.repeat(64))
    })
  })

  describe('BRC-100 interface methods', () => {
    it('should delegate getPublicKey to MPC wallet', async () => {
      const args = { protocolID: [1, 'test'] as [number, string], keyID: 'key1' }
      await wallet.getPublicKey(args)

      expect(mockMPCWallet.getPublicKey).toHaveBeenCalledWith({
        identityKey: undefined,
        protocolID: [1, 'test'],
        keyID: 'key1',
        counterparty: undefined,
        forSelf: undefined,
      })
    })

    it('should delegate encrypt to MPC wallet', async () => {
      const result = await wallet.encrypt({
        plaintext: [1, 2, 3],
        protocolID: [1, 'encrypt'],
        keyID: 'key1',
      })

      expect(result.ciphertext).toEqual([1, 2, 3, 4])
      expect(mockMPCWallet.encrypt).toHaveBeenCalled()
    })

    it('should delegate decrypt to MPC wallet', async () => {
      const result = await wallet.decrypt({
        ciphertext: [1, 2, 3, 4],
        protocolID: [1, 'decrypt'],
        keyID: 'key1',
      })

      expect(result.plaintext).toEqual([5, 6, 7, 8])
      expect(mockMPCWallet.decrypt).toHaveBeenCalled()
    })

    it('should delegate createSignature to MPC wallet', async () => {
      const result = await wallet.createSignature({
        data: [1, 2, 3],
        protocolID: [1, 'sign'],
        keyID: 'key1',
      })

      expect(result.signature).toEqual([9, 10, 11, 12])
      expect(mockMPCWallet.createSignature).toHaveBeenCalled()
    })

    it('should delegate verifySignature to MPC wallet', async () => {
      const result = await wallet.verifySignature({
        data: [1, 2, 3],
        signature: [9, 10, 11, 12],
        protocolID: [1, 'sign'],
        keyID: 'key1',
      })

      expect(result.valid).toBe(true)
      expect(mockMPCWallet.verifySignature).toHaveBeenCalled()
    })

    it('should delegate createHmac to MPC wallet', async () => {
      const result = await wallet.createHmac({
        data: [1, 2, 3],
        protocolID: [1, 'hmac'],
        keyID: 'key1',
      })

      expect(result.hmac).toEqual([13, 14, 15, 16])
    })

    it('should delegate verifyHmac to MPC wallet', async () => {
      const result = await wallet.verifyHmac({
        data: [1, 2, 3],
        hmac: [13, 14, 15, 16],
        protocolID: [1, 'hmac'],
        keyID: 'key1',
      })

      expect(result.valid).toBe(true)
    })

    it('should delegate createAction to MPC wallet', async () => {
      const result = await wallet.createAction({
        description: 'Test action',
        outputs: [{ script: 'abc', satoshis: 1000 }],
      })

      expect(result.txid).toBe('mock-txid-123')
      expect(mockMPCWallet.createAction).toHaveBeenCalled()
    })

    it('should delegate getHeight to MPC wallet', async () => {
      const height = await wallet.getHeight()
      expect(height).toBe(850000)
    })
  })

  describe('signing lock', () => {
    it('should serialize concurrent createSignature calls', async () => {
      const callOrder: number[] = []
      let resolveFirst: () => void
      let resolveSecond: () => void

      // Make createSignature calls track order and be controllable
      ;(mockMPCWallet.createSignature as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          return new Promise<{ signature: number[] }>((resolve) => {
            callOrder.push(1)
            resolveFirst = () => {
              callOrder.push(2) // First completes
              resolve({ signature: [1] })
            }
          })
        })
        .mockImplementationOnce(() => {
          return new Promise<{ signature: number[] }>((resolve) => {
            callOrder.push(3) // Second starts after first
            resolveSecond = () => {
              callOrder.push(4)
              resolve({ signature: [2] })
            }
          })
        })

      // Start both calls concurrently
      const promise1 = wallet.createSignature({
        data: [1],
        protocolID: [1, 'test'],
        keyID: 'key1',
      })
      const promise2 = wallet.createSignature({
        data: [2],
        protocolID: [1, 'test'],
        keyID: 'key2',
      })

      // Let first start
      await new Promise((r) => setTimeout(r, 10))
      expect(callOrder).toEqual([1]) // Only first started

      // Complete first
      resolveFirst!()
      await promise1

      // Now second should start
      await new Promise((r) => setTimeout(r, 10))
      expect(callOrder).toEqual([1, 2, 3]) // First complete, second started

      // Complete second
      resolveSecond!()
      await promise2

      expect(callOrder).toEqual([1, 2, 3, 4]) // Both complete in order
    })

    it('should serialize createAction calls (also uses signing)', async () => {
      const callOrder: string[] = []

      ;(mockMPCWallet.createAction as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => {
          callOrder.push('action1-start')
          await new Promise((r) => setTimeout(r, 50))
          callOrder.push('action1-end')
          return { txid: 'tx1' }
        })
        .mockImplementationOnce(async () => {
          callOrder.push('action2-start')
          await new Promise((r) => setTimeout(r, 10))
          callOrder.push('action2-end')
          return { txid: 'tx2' }
        })

      // Start both concurrently
      const [result1, result2] = await Promise.all([
        wallet.createAction({ description: 'Action 1' }),
        wallet.createAction({ description: 'Action 2' }),
      ])

      expect(result1.txid).toBe('tx1')
      expect(result2.txid).toBe('tx2')

      // Should be serialized: action1 fully completes before action2 starts
      expect(callOrder).toEqual([
        'action1-start',
        'action1-end',
        'action2-start',
        'action2-end',
      ])
    })
  })

  describe('factory function', () => {
    it('should create and initialize wallet', async () => {
      const { wallet: createdWallet } = await createMPCAgentWallet({
        walletId: 'factory-test',
        cosignerEndpoints: ['http://localhost:8081'],
        shareSecret: 'secret',
        jwtSecret: 'jwt-secret',
        mpcWallet: mockMPCWallet,
      })

      expect(createdWallet.isInitialized()).toBe(true)
      expect(await createdWallet.isAuthenticated()).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should destroy underlying MPC wallet on destroy', async () => {
      await wallet.destroy()

      expect(mockMPCWallet.destroy).toHaveBeenCalled()
      expect(wallet.isInitialized()).toBe(false)
      expect(wallet.getUnderlyingMPCWallet()).toBeNull()
    })
  })

  describe('Uint8Array handling', () => {
    it('should convert Uint8Array to number[] for encrypt', async () => {
      await wallet.encrypt({
        plaintext: new Uint8Array([1, 2, 3]),
        protocolID: [1, 'test'],
        keyID: 'key1',
      })

      expect(mockMPCWallet.encrypt).toHaveBeenCalledWith(
        expect.objectContaining({
          plaintext: [1, 2, 3],
        })
      )
    })

    it('should convert Uint8Array to number[] for createSignature', async () => {
      await wallet.createSignature({
        data: new Uint8Array([1, 2, 3]),
        protocolID: [1, 'test'],
        keyID: 'key1',
      })

      expect(mockMPCWallet.createSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [1, 2, 3],
        })
      )
    })
  })
})

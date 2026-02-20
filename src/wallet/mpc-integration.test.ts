/**
 * MPC Production Integration Tests
 *
 * Tests for the production MPC wallet factory with live cosigner servers.
 *
 * These tests require:
 * 1. wallet-toolbox-mpc built (npm run build in MPC-DEV/wallet-toolbox-mpc)
 * 2. Cosigner servers built (npm run build in MPC-DEV/mpc-test-app/cosigner-servers)
 * 3. Test database directory (./test-data)
 *
 * Run with: npm test -- --testPathPattern=mpc-integration.test
 *
 * Note: Live integration tests are marked with .skip by default because they require
 * running cosigner servers. To run them:
 * 1. Start cosigner servers manually (see instructions below)
 * 2. Set MPC_LIVE_TEST=1 environment variable
 * 3. Run: MPC_LIVE_TEST=1 npm test -- --testPathPattern=mpc-integration.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './mpc-integration.js'
import type { ProductionMPCConfig, ProductionMPCWalletResult } from './mpc-integration.js'

// Test configuration
const TEST_DB_PATH = './test-data/mpc-integration-test.sqlite'
const TEST_JWT_SECRET = 'test-jwt-secret-for-integration-tests'
const TEST_SHARE_SECRET = 'test-share-secret-12345'
const TEST_WALLET_ID = 'integration-test-wallet'

// Cosigner ports (use high ports to avoid conflicts)
const COSIGNER_1_PORT = 18081
const COSIGNER_2_PORT = 18082

// Check if live tests should run
const LIVE_TEST_ENABLED = process.env.MPC_LIVE_TEST === '1'

/**
 * Start a cosigner server as a child process
 */
async function startCosigner(partyId: string, port: number): Promise<ChildProcess> {
  const cosignerDir = path.resolve(__dirname, '../../MPC-DEV/mpc-test-app/cosigner-servers')
  const distServer = path.join(cosignerDir, 'dist/server.js')

  // Check if the server is built
  if (!fs.existsSync(distServer)) {
    throw new Error(
      `Cosigner server not built. Run: cd ${cosignerDir} && npm run build`
    )
  }

  const env = {
    ...process.env,
    PARTY_ID: partyId,
    PORT: port.toString(),
    JWT_SECRET: TEST_JWT_SECRET,
    LOG_LEVEL: 'warn',
  }

  const proc = spawn('node', [distServer], {
    cwd: cosignerDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Cosigner ${partyId} failed to start within 10 seconds`))
    }, 10000)

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (output.includes('Server started') || output.includes('listening')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[Cosigner ${partyId}] stderr:`, data.toString())
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout)
        reject(new Error(`Cosigner ${partyId} exited with code ${code}`))
      }
    })
  })

  return proc
}

/**
 * Stop a cosigner server
 */
function stopCosigner(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || proc.exitCode !== null) {
      resolve()
      return
    }

    proc.on('exit', () => resolve())
    proc.kill('SIGTERM')

    // Force kill after 5 seconds
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL')
      }
    }, 5000)
  })
}

/**
 * Clean up test database
 */
function cleanupTestDatabase(): void {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH)
  }
  // Also remove WAL and SHM files
  const walPath = TEST_DB_PATH + '-wal'
  const shmPath = TEST_DB_PATH + '-shm'
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
}

/**
 * Ensure test data directory exists
 */
function ensureTestDir(): void {
  const testDir = path.dirname(TEST_DB_PATH)
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }
}

// ============================================================================
// Unit Tests (always run - no external dependencies)
// ============================================================================

describe('MPC Integration - Unit Tests', () => {
  describe('loadMPCConfigFromEnv', () => {
    const originalEnv = process.env

    beforeAll(() => {
      // Clear MPC env vars for testing
      delete process.env.MPC_WALLET_ID
      delete process.env.MPC_COSIGNER_ENDPOINTS
      delete process.env.MPC_SHARE_SECRET
      delete process.env.MPC_JWT_SECRET
      delete process.env.MPC_NETWORK
      delete process.env.MPC_STORAGE_PATH
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('should throw if MPC_COSIGNER_ENDPOINTS is not set', () => {
      process.env.MPC_SHARE_SECRET = 'secret'
      process.env.MPC_JWT_SECRET = 'jwt'

      expect(() => loadMPCConfigFromEnv()).toThrow('MPC_COSIGNER_ENDPOINTS')
    })

    it('should throw if MPC_SHARE_SECRET is not set', () => {
      process.env.MPC_COSIGNER_ENDPOINTS = 'http://localhost:8081'
      delete process.env.MPC_SHARE_SECRET
      process.env.MPC_JWT_SECRET = 'jwt'

      expect(() => loadMPCConfigFromEnv()).toThrow('MPC_SHARE_SECRET')
    })

    it('should throw if MPC_JWT_SECRET is not set', () => {
      process.env.MPC_COSIGNER_ENDPOINTS = 'http://localhost:8081'
      process.env.MPC_SHARE_SECRET = 'secret'
      delete process.env.MPC_JWT_SECRET

      expect(() => loadMPCConfigFromEnv()).toThrow('MPC_JWT_SECRET')
    })

    it('should load config with all required env vars', () => {
      process.env.MPC_COSIGNER_ENDPOINTS = 'http://localhost:8081,http://localhost:8082'
      process.env.MPC_SHARE_SECRET = 'test-secret'
      process.env.MPC_JWT_SECRET = 'test-jwt'

      const config = loadMPCConfigFromEnv()

      expect(config.cosignerEndpoints).toEqual([
        'http://localhost:8081',
        'http://localhost:8082',
      ])
      expect(config.shareSecret).toBe('test-secret')
      expect(config.jwtSecret).toBe('test-jwt')
      expect(config.walletId).toBe('agent-wallet') // default
      expect(config.network).toBe('mainnet') // default
      expect(config.storagePath).toBe('./data/mpc-wallet.sqlite') // default
    })

    it('should use custom values when set', () => {
      process.env.MPC_WALLET_ID = 'custom-wallet'
      process.env.MPC_COSIGNER_ENDPOINTS = 'http://cosigner1.example.com'
      process.env.MPC_SHARE_SECRET = 'custom-secret'
      process.env.MPC_JWT_SECRET = 'custom-jwt'
      process.env.MPC_NETWORK = 'testnet'
      process.env.MPC_STORAGE_PATH = '/tmp/wallet.sqlite'

      const config = loadMPCConfigFromEnv()

      expect(config.walletId).toBe('custom-wallet')
      expect(config.network).toBe('testnet')
      expect(config.storagePath).toBe('/tmp/wallet.sqlite')
    })

    it('should handle comma-separated endpoints with whitespace', () => {
      process.env.MPC_COSIGNER_ENDPOINTS = '  http://a.com ,  http://b.com  ,http://c.com'
      process.env.MPC_SHARE_SECRET = 'secret'
      process.env.MPC_JWT_SECRET = 'jwt'

      const config = loadMPCConfigFromEnv()

      expect(config.cosignerEndpoints).toEqual([
        'http://a.com',
        'http://b.com',
        'http://c.com',
      ])
    })
  })
})

// ============================================================================
// Live Integration Tests (require running cosigner servers)
// ============================================================================

describe.skipIf(!LIVE_TEST_ENABLED)('MPC Integration - Live Tests', () => {
  let cosigner1: ChildProcess
  let cosigner2: ChildProcess
  let firstWalletResult: ProductionMPCWalletResult | null = null

  beforeAll(async () => {
    console.log('Starting cosigner servers for live integration tests...')

    // Ensure test directory exists
    ensureTestDir()

    // Clean up any previous test data
    cleanupTestDatabase()

    // Start cosigner servers
    try {
      cosigner1 = await startCosigner('2', COSIGNER_1_PORT)
      console.log(`Cosigner 1 (party 2) started on port ${COSIGNER_1_PORT}`)

      cosigner2 = await startCosigner('3', COSIGNER_2_PORT)
      console.log(`Cosigner 2 (party 3) started on port ${COSIGNER_2_PORT}`)
    } catch (err) {
      console.error('Failed to start cosigner servers:', err)
      throw err
    }

    // Give servers a moment to fully initialize
    await new Promise((r) => setTimeout(r, 1000))
  }, 60000) // 60 second timeout for startup

  afterAll(async () => {
    console.log('Stopping cosigner servers...')

    // Stop cosigner servers
    if (cosigner1) await stopCosigner(cosigner1)
    if (cosigner2) await stopCosigner(cosigner2)

    // Clean up test database
    cleanupTestDatabase()

    console.log('Cleanup complete')
  }, 30000)

  it('should create new wallet via DKG', async () => {
    const config: ProductionMPCConfig = {
      walletId: TEST_WALLET_ID,
      cosignerEndpoints: [
        `http://localhost:${COSIGNER_1_PORT}`,
        `http://localhost:${COSIGNER_2_PORT}`,
      ],
      shareSecret: TEST_SHARE_SECRET,
      jwtSecret: TEST_JWT_SECRET,
      network: 'testnet',
      storagePath: TEST_DB_PATH,
      onProgress: (info) => {
        console.log(`DKG Progress: Round ${info.round}/${info.total} - ${info.message}`)
      },
    }

    // Create wallet via DKG
    const result = await createProductionMPCWallet(config)
    firstWalletResult = result

    // Verify it's a new wallet
    expect(result.isNewWallet).toBe(true)
    expect(result.collectivePublicKey).toBeDefined()
    expect(result.collectivePublicKey.length).toBe(66) // Compressed pubkey
    expect(result.collectivePublicKey.startsWith('02') || result.collectivePublicKey.startsWith('03')).toBe(true)
    expect(result.wallet).toBeDefined()

    console.log(`New wallet created with collective public key: ${result.collectivePublicKey}`)
  }, 120000) // 2 minute timeout for DKG

  it('should restore existing wallet from share', async () => {
    // Skip if first test didn't run
    if (!firstWalletResult) {
      console.log('Skipping restore test - DKG test did not run')
      return
    }

    const config: ProductionMPCConfig = {
      walletId: TEST_WALLET_ID,
      cosignerEndpoints: [
        `http://localhost:${COSIGNER_1_PORT}`,
        `http://localhost:${COSIGNER_2_PORT}`,
      ],
      shareSecret: TEST_SHARE_SECRET,
      jwtSecret: TEST_JWT_SECRET,
      network: 'testnet',
      storagePath: TEST_DB_PATH,
    }

    // Restore wallet
    const result = await createProductionMPCWallet(config)

    // Verify it's a restored wallet (not new)
    expect(result.isNewWallet).toBe(false)
    expect(result.collectivePublicKey).toBe(firstWalletResult.collectivePublicKey)
    expect(result.wallet).toBeDefined()

    console.log(`Wallet restored with same collective public key: ${result.collectivePublicKey}`)
  }, 60000)

  it('should fail restore with wrong password', async () => {
    // Skip if first test didn't run
    if (!firstWalletResult) {
      console.log('Skipping wrong password test - DKG test did not run')
      return
    }

    const config: ProductionMPCConfig = {
      walletId: TEST_WALLET_ID,
      cosignerEndpoints: [
        `http://localhost:${COSIGNER_1_PORT}`,
        `http://localhost:${COSIGNER_2_PORT}`,
      ],
      shareSecret: 'wrong-password-12345', // Wrong password
      jwtSecret: TEST_JWT_SECRET,
      network: 'testnet',
      storagePath: TEST_DB_PATH,
    }

    // Should fail with password error
    await expect(createProductionMPCWallet(config)).rejects.toThrow(
      /password|decrypt/i
    )
  }, 30000)
})

// ============================================================================
// Test instructions for manual testing
// ============================================================================

/*
# Manual Testing Instructions

## Prerequisites

1. Build wallet-toolbox-mpc:
   cd MPC-DEV/wallet-toolbox-mpc
   npm install
   npm run build

2. Build cosigner servers:
   cd MPC-DEV/mpc-test-app/cosigner-servers
   npm install
   npm run build

## Running Live Tests

### Option 1: Auto-start cosigners (recommended)

Set MPC_LIVE_TEST=1 and run tests:
```bash
MPC_LIVE_TEST=1 npm test -- --testPathPattern=mpc-integration.test
```

### Option 2: Manual cosigner start

1. Start cosigner 1 in terminal 1:
   cd MPC-DEV/mpc-test-app/cosigner-servers
   PARTY_ID=2 PORT=18081 JWT_SECRET=test-jwt-secret-for-integration-tests node dist/server.js

2. Start cosigner 2 in terminal 2:
   cd MPC-DEV/mpc-test-app/cosigner-servers
   PARTY_ID=3 PORT=18082 JWT_SECRET=test-jwt-secret-for-integration-tests node dist/server.js

3. Run tests:
   MPC_LIVE_TEST=1 npm test -- --testPathPattern=mpc-integration.test

## Troubleshooting

- If DKG fails, check that cosigners are running and accessible
- If restore fails, check that the database file exists at ./test-data/mpc-integration-test.sqlite
- Check cosigner logs for errors
- Verify JWT_SECRET matches across all processes
*/

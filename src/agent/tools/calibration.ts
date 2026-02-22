/**
 * Base2 Calibration Tools
 *
 * Agent tools for publishing content, funding calibration, reading calibrated data,
 * and split-testing content variants via the Base2 overlay network.
 */

import { lockPushDropToken } from '../../wallet/pushdrop-ops.js';
import { OverlayClient } from '../../integrations/overlay/index.js';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

const BASE2_KEY_SERVER = process.env.BASE2_KEY_SERVER || 'http://localhost:3000';

export function calibrationTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_publish_content',
        description: 'Publish content to the Base2 calibration marketplace. Creates a PushDrop token on tm_content overlay with UHRP-uploaded file reference.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Content title (max 200 chars)' },
            description: { type: 'string', description: 'Content description (max 1000 chars)' },
            contentType: { type: 'string', description: 'One of: art, literature, text, inference, weight-config' },
            content: { type: 'string', description: 'The text content to publish (will be uploaded to UHRP)' },
            encrypted: { type: 'boolean', description: 'Whether to encrypt the content (default: false)' },
          },
          required: ['title', 'description', 'contentType', 'content'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const title = params.title as string;
        const description = params.description as string;
        const contentType = params.contentType as string;
        const content = params.content as string;
        const encrypted = (params.encrypted as boolean) ?? false;

        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');

        // Get creator identity key
        const { publicKey: creatorKey } = await underlyingWallet.getPublicKey({ identityKey: true });

        // Upload content to UHRP via StorageUploader
        const { StorageUploader } = await import('@bsv/sdk');
        const storageUploader = new StorageUploader({
          storageURL: 'https://nanostore.babbage.systems',
          wallet: underlyingWallet,
        });

        let fileData = Array.from(new TextEncoder().encode(content));
        if (encrypted) {
          const { SymmetricKey } = await import('@bsv/sdk');
          const key = SymmetricKey.fromRandom();
          fileData = key.encrypt(fileData) as number[];
        }

        const uploaded = await storageUploader.publishFile({
          file: { data: fileData, type: 'text/plain' },
          retentionPeriod: 525600, // 1 year
        });

        // Create PushDrop token
        const fields = [
          uploaded.uhrpURL,
          title,
          description,
          contentType,
          creatorKey,
          new Date().toISOString(),
          encrypted ? 'true' : 'false',
        ];

        const result = await lockPushDropToken(ctx.wallet, {
          fields,
          protocolID: [2, 'base2 content'],
          keyID: '1',
          basket: 'base2_content',
          counterparty: 'anyone',
          description: `Publish: ${title.substring(0, 30)}`,
        });

        return ok({
          published: true,
          txid: result.txid,
          vout: result.vout,
          uhrpUrl: uploaded.uhrpURL,
          title,
          contentType,
          encrypted,
        });
      },
    },
    {
      definition: {
        name: 'agid_fund_calibration',
        description: 'Fund calibration for published Base2 content. Deposits sats to the key server to pay validators.',
        input_schema: {
          type: 'object',
          properties: {
            contentTxid: { type: 'string', description: 'Transaction ID of the published content' },
            contentVout: { type: 'number', description: 'Output index of the content (default: 0)' },
            totalAmount: { type: 'number', description: 'Total sats to deposit for calibration' },
            satsPerCalibration: { type: 'number', description: 'Sats paid to each validator per calibration' },
          },
          required: ['contentTxid', 'totalAmount', 'satsPerCalibration'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const contentTxid = params.contentTxid as string;
        const contentVout = (params.contentVout as number) ?? 0;
        const totalAmount = params.totalAmount as number;
        const satsPerCalibration = params.satsPerCalibration as number;

        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');

        const { AuthFetch } = await import('@bsv/sdk');
        const authFetch = new AuthFetch(underlyingWallet);

        const response = await authFetch.fetch(`${BASE2_KEY_SERVER}/fund`, {
          method: 'POST',
          body: JSON.stringify({ contentTxid, contentVout, totalAmount, satsPerCalibration }),
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const errBody = await response.json() as Record<string, string>;
          throw new Error(`Fund failed: ${errBody.error || response.statusText}`);
        }

        const resBody = await response.json() as Record<string, unknown>;
        return ok({
          funded: true,
          contentTxid,
          contentVout,
          totalAmount,
          satsPerCalibration,
          maxCalibrations: Math.floor(totalAmount / satsPerCalibration),
          message: resBody.message as string,
        });
      },
    },
    {
      definition: {
        name: 'agid_read_calibrations',
        description: 'Read calibration data from the Base2 overlay network. Query content, stats, high-scoring items, or uncalibrated content.',
        input_schema: {
          type: 'object',
          properties: {
            queryType: { type: 'string', description: 'Query type: findByContent, getStats, findHighCal, findUncalibrated, findByValidator' },
            contentTxid: { type: 'string', description: 'Content transaction ID (for findByContent, getStats)' },
            contentVout: { type: 'number', description: 'Content output index (default: 0)' },
            minScore: { type: 'number', description: 'Minimum mean score threshold (for findHighCal)' },
            contentType: { type: 'string', description: 'Filter by content type (for findHighCal)' },
            validatorKey: { type: 'string', description: 'Validator public key (for findByValidator)' },
          },
          required: ['queryType'],
        },
      },
      requiresWallet: false,
      execute: async (params) => {
        const queryType = params.queryType as string;
        const client = new OverlayClient();

        let query: Record<string, unknown>;
        let service = 'ls_calibration';

        switch (queryType) {
          case 'findByContent':
            query = { type: 'findByContent', value: { contentTxid: params.contentTxid, contentVout: (params.contentVout as number) ?? 0 } };
            break;
          case 'getStats':
            query = { type: 'getStats', value: { contentTxid: params.contentTxid, contentVout: (params.contentVout as number) ?? 0 } };
            break;
          case 'findHighCal':
            query = { type: 'findHighCal', value: { minScore: params.minScore ?? 200, contentType: params.contentType } };
            break;
          case 'findUncalibrated':
            query = { type: 'findUncalibrated' };
            break;
          case 'findByValidator':
            query = { type: 'findByValidator', value: { validatorKey: params.validatorKey } };
            break;
          default:
            throw new Error(`Unknown query type: ${queryType}`);
        }

        const outputs = await client.query(service, query);
        return ok({ queryType, service, outputs, total: outputs.length });
      },
    },
    {
      definition: {
        name: 'agid_split_test',
        description: 'Run a split test: publish N content variants, fund calibration for all, poll for results, and return the winner by highest mean score.',
        input_schema: {
          type: 'object',
          properties: {
            variants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  content: { type: 'string' },
                  contentType: { type: 'string' },
                },
                required: ['title', 'content'],
              },
              description: 'Array of content variants to test',
            },
            satsPerCalibration: { type: 'number', description: 'Sats per calibration per variant (default: 100)' },
            maxCalibrations: { type: 'number', description: 'Max calibrations per variant (default: 5)' },
            pollIntervalMs: { type: 'number', description: 'Poll interval in ms (default: 30000)' },
            maxPollAttempts: { type: 'number', description: 'Max poll attempts before returning partial results (default: 20)' },
          },
          required: ['variants'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const variants = params.variants as Array<{ title: string; description?: string; content: string; contentType?: string }>;
        const satsPerCal = (params.satsPerCalibration as number) ?? 100;
        const maxCals = (params.maxCalibrations as number) ?? 5;
        const pollInterval = (params.pollIntervalMs as number) ?? 30000;
        const maxPolls = (params.maxPollAttempts as number) ?? 20;

        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');

        const { StorageUploader, AuthFetch } = await import('@bsv/sdk');

        const published: Array<{ txid: string; vout: number; title: string }> = [];

        // Publish all variants
        for (const variant of variants) {
          const storageUploader = new StorageUploader({
            storageURL: 'https://nanostore.babbage.systems',
            wallet: underlyingWallet,
          });

          const fileData = Array.from(new TextEncoder().encode(variant.content));
          const uploaded = await storageUploader.publishFile({
            file: { data: fileData, type: 'text/plain' },
            retentionPeriod: 525600,
          });

          const { publicKey: creatorKey } = await underlyingWallet.getPublicKey({ identityKey: true });

          const fields = [
            uploaded.uhrpURL,
            variant.title,
            variant.description || '',
            variant.contentType || 'text',
            creatorKey,
            new Date().toISOString(),
            'false',
          ];

          const result = await lockPushDropToken(ctx.wallet, {
            fields,
            protocolID: [2, 'base2 content'],
            keyID: '1',
            basket: 'base2_content',
            counterparty: 'anyone',
            description: `Split test: ${variant.title.substring(0, 20)}`,
          });

          published.push({ txid: result.txid, vout: result.vout, title: variant.title });
        }

        // Fund all variants
        const authFetch = new AuthFetch(underlyingWallet);
        for (const pub of published) {
          await authFetch.fetch(`${BASE2_KEY_SERVER}/fund`, {
            method: 'POST',
            body: JSON.stringify({
              contentTxid: pub.txid,
              contentVout: pub.vout,
              totalAmount: satsPerCal * maxCals,
              satsPerCalibration: satsPerCal,
            }),
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Poll for results
        const client = new OverlayClient();
        let allDone = false;
        let attempts = 0;

        const results: Array<{ txid: string; title: string; stats: any }> = [];

        while (!allDone && attempts < maxPolls) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          results.length = 0;
          allDone = true;

          for (const pub of published) {
            try {
              const outputs = await client.query('ls_calibration', {
                type: 'getStats',
                value: { contentTxid: pub.txid, contentVout: pub.vout },
              });
              const stats = (outputs as any)?.result ?? (outputs.length > 0 ? outputs[0] : { count: 0 });
              results.push({ txid: pub.txid, title: pub.title, stats });
              if (!stats.count || stats.count < maxCals) allDone = false;
            } catch {
              results.push({ txid: pub.txid, title: pub.title, stats: { count: 0 } });
              allDone = false;
            }
          }
        }

        // Determine winner
        const sorted = [...results].sort((a, b) => (b.stats?.mean ?? 0) - (a.stats?.mean ?? 0));
        const winner = sorted[0];

        return ok({
          completed: allDone,
          pollAttempts: attempts,
          variants: results,
          winner: winner ? { txid: winner.txid, title: winner.title, meanScore: winner.stats?.mean ?? 0 } : null,
        });
      },
    },
  ];
}

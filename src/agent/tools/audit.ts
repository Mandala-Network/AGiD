import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIntegrity } from '../../audit/workspace-integrity.js';
import { AnchorChain } from '../../audit/anchor-chain.js';
import type { AnchorChainData } from '../../audit/anchor-chain.js';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function auditTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_verify_workspace',
        description: 'Verify workspace file integrity against the last on-chain anchor.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      requiresWallet: false,
      execute: async (_params, ctx) => {
        if (!ctx.workspacePath) throw new Error('workspacePath not configured');
        const integrity = new WorkspaceIntegrity(ctx.workspacePath);
        const currentHash = await integrity.hashWorkspace();
        const lastAnchor = await integrity.getLastAnchor(ctx.wallet);

        if (!lastAnchor) {
          return ok({
            verified: false,
            message: 'No previous on-chain anchor found. This may be a first session.',
            currentFiles: Object.keys(currentHash.files),
            combinedHash: currentHash.combinedHash,
          });
        }

        const matched = currentHash.combinedHash === lastAnchor.workspaceHash;
        return ok({
          verified: matched,
          lastAnchorTxid: lastAnchor.txid,
          currentCombinedHash: currentHash.combinedHash,
          anchoredCombinedHash: lastAnchor.workspaceHash,
          files: currentHash.files,
          message: matched
            ? 'Workspace integrity verified against on-chain anchor.'
            : 'Workspace has changed since last on-chain anchor.',
        });
      },
    },
    {
      definition: {
        name: 'agid_verify_session',
        description: 'Verify the anchor chain integrity for a past session.',
        input_schema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to verify' },
          },
          required: ['sessionId'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        if (!ctx.sessionsPath) throw new Error('sessionsPath not configured');
        const sessionId = params.sessionId as string;
        const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const anchorPath = path.join(ctx.sessionsPath, `${safe}.anchor.json`);

        if (!fs.existsSync(anchorPath)) {
          return ok({ verified: false, error: `No anchor chain found for session: ${sessionId}` });
        }

        const data: AnchorChainData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
        const chain = AnchorChain.fromSerialized(data);
        const verification = await chain.verify();
        const merkleRoot = await chain.getMerkleRoot();

        return ok({
          verified: verification.valid,
          sessionId: data.sessionId,
          anchorCount: data.anchors.length,
          headHash: data.headHash,
          merkleRoot,
          errors: verification.errors,
        });
      },
    },
  ];
}

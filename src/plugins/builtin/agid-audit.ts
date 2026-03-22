/**
 * AGiD Audit Plugin
 *
 * Tools for verifying workspace integrity and session anchor chains.
 */

import * as fs from 'fs';
import * as path from 'path';
import { definePluginEntry } from '../define-plugin-entry.js';
import { WorkspaceIntegrity } from '../../audit/workspace-integrity.js';
import { AnchorChain } from '../../audit/anchor-chain.js';
import type { AnchorChainData } from '../../audit/anchor-chain.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidAuditPlugin = definePluginEntry({
  id: 'agid-audit',
  name: 'AGiD Audit',
  register(api) {
    api.registerTool(
      {
        name: 'agid_verify_workspace',
        description: 'Verify workspace file integrity against the last on-chain anchor.',
        parameters: { type: 'object', properties: {} },
        async execute(_id, _params, ctx) {
          const workspacePath = process.env.AGID_WORKSPACE_PATH;
          if (!workspacePath) {
            return json({ error: 'AGID_WORKSPACE_PATH not configured' });
          }
          const integrity = new WorkspaceIntegrity(workspacePath);
          const currentHash = await integrity.hashWorkspace();
          const lastAnchor = await integrity.getLastAnchor(ctx?.wallet);

          if (!lastAnchor) {
            return json({
              verified: false,
              message: 'No previous on-chain anchor found.',
              currentFiles: Object.keys(currentHash.files),
              combinedHash: currentHash.combinedHash,
            });
          }

          const matched = currentHash.combinedHash === lastAnchor.workspaceHash;
          return json({
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
      { group: 'audit' },
    );

    api.registerTool(
      {
        name: 'agid_verify_session',
        description: 'Verify the anchor chain integrity for a past session.',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to verify' },
          },
          required: ['sessionId'],
        },
        async execute(_id, params) {
          const sessionsPath = process.env.AGID_SESSIONS_PATH;
          if (!sessionsPath) {
            return json({ error: 'AGID_SESSIONS_PATH not configured' });
          }
          const sessionId = params.sessionId as string;
          const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const anchorPath = path.join(sessionsPath, `${safe}.anchor.json`);

          if (!fs.existsSync(anchorPath)) {
            return json({ verified: false, error: `No anchor chain found for session: ${sessionId}` });
          }

          const data: AnchorChainData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
          const chain = AnchorChain.fromSerialized(data);
          const verification = await chain.verify();
          const merkleRoot = await chain.getMerkleRoot();

          return json({
            verified: verification.valid,
            sessionId: data.sessionId,
            anchorCount: data.anchors.length,
            headHash: data.headHash,
            merkleRoot,
            errors: verification.errors,
          });
        },
      },
      { group: 'audit' },
    );
  },
});

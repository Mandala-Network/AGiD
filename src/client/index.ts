/**
 * AGIdentity Client SDK
 *
 * Authenticated HTTP client for AGIdentity servers.
 */

export {
  AGIDClient,
  createAGIDClient,
} from './agidentity-client.js';

export type {
  AGIDClientConfig,
  APIResponse,
  IdentityInfo,
  SessionInfo,
  VaultInfo,
  StoredDocument,
  DocumentEntry,
  SearchResult,
  VaultProof,
  TeamInfo,
  TeamDetails,
  TeamMember,
  AccessCheck,
  TeamDocument,
  SignatureResult,
  VerificationResult,
  HealthStatus,
  SessionStatus,
} from './agidentity-client.js';

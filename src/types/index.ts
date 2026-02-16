/**
 * AGIdentity Core Types
 *
 * Type definitions for the AGIdentity system including wallet interfaces,
 * encryption contexts, and UHRP storage types.
 */

// Re-export OpenClaw Gateway types
export * from './openclaw-gateway.js';

// ============================================================================
// Wallet Types (BRC-100 Compatible)
// ============================================================================

export interface BRC100Wallet {
  // Identity
  getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult>;

  // Encryption
  encrypt(args: EncryptArgs): Promise<EncryptResult>;
  decrypt(args: DecryptArgs): Promise<DecryptResult>;

  // Signatures
  createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult>;
  verifySignature(args: VerifySignatureArgs): Promise<VerifySignatureResult>;

  // HMAC
  createHmac(args: CreateHmacArgs): Promise<CreateHmacResult>;
  verifyHmac(args: VerifyHmacArgs): Promise<VerifyHmacResult>;

  // Transactions
  createAction(args: CreateActionArgs): Promise<CreateActionResult>;

  // Certificates
  acquireCertificate(args: AcquireCertificateArgs): Promise<AcquireCertificateResult>;
  listCertificates(args: ListCertificatesArgs): Promise<ListCertificatesResult>;

  // Network
  getNetwork(): Promise<'mainnet' | 'testnet'>;
  getHeight(): Promise<number>;
  isAuthenticated(): Promise<boolean>;
}

export interface GetPublicKeyArgs {
  identityKey?: boolean;
  protocolID?: [number, string];  // [securityLevel, protocolId]
  keyID?: string;
  counterparty?: string;
  forSelf?: boolean;
}

export interface GetPublicKeyResult {
  publicKey: string;  // 33-byte compressed DER format
}

export interface EncryptArgs {
  plaintext: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface EncryptResult {
  ciphertext: number[];
}

export interface DecryptArgs {
  ciphertext: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface DecryptResult {
  plaintext: number[];
}

export interface CreateSignatureArgs {
  data: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface CreateSignatureResult {
  signature: number[];
}

export interface VerifySignatureArgs {
  data: number[] | Uint8Array;
  signature: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface VerifySignatureResult {
  valid: boolean;
}

export interface CreateHmacArgs {
  data: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface CreateHmacResult {
  hmac: number[];
}

export interface VerifyHmacArgs {
  data: number[] | Uint8Array;
  hmac: number[] | Uint8Array;
  protocolID: [number, string];
  keyID: string;
  counterparty?: string;
}

export interface VerifyHmacResult {
  valid: boolean;
}

export interface CreateActionArgs {
  description: string;
  outputs?: TransactionOutput[];
  inputs?: TransactionInput[];
  labels?: string[];
  lockTime?: number;
  version?: number;
  options?: {
    acceptDelayedBroadcast?: boolean;
    trustSelf?: 'known';
    randomizeOutputs?: boolean;
    [key: string]: unknown;
  };
}

export interface TransactionOutput {
  script: string;
  satoshis: number;
  description?: string;
  basket?: string;
  tags?: string[];
}

export interface TransactionInput {
  outpoint: string;
  unlockingScript?: string;
  inputDescription?: string;
}

export interface CreateActionResult {
  txid: string;
  rawTx?: number[];
}

export interface AcquireCertificateArgs {
  type: string;
  certifier: string;
  acquisitionProtocol: 'issuance' | 'direct';
  fields?: Record<string, string>;
}

export interface AcquireCertificateResult {
  certificate: Certificate;
}

export interface Certificate {
  type: string;
  serialNumber: string;
  subject: string;
  certifier: string;
  revocationOutpoint: string;
  fields: Record<string, string>;
  signature: string;
}

export interface ListCertificatesArgs {
  certifiers?: string[];
  types?: string[];
}

export interface ListCertificatesResult {
  certificates: Certificate[];
}

// ============================================================================
// UHRP Storage Types
// ============================================================================

export interface UHRPDocument {
  uhrpUrl: string;
  encryptedContent: Uint8Array;
  metadata: UHRPDocumentMetadata;
  blockchainTxId?: string;
}

export interface UHRPDocumentMetadata {
  filename: string;
  mimeType: string;
  uploadedAt: number;
  expiresAt: number;
  userPublicKey: string;
  encryptionKeyId: string;
  contentHash: string;
}

export interface UploadableFile {
  data: Uint8Array | number[];
  type: string;
}

export interface UploadFileResult {
  published: boolean;
  uhrpUrl: string;
}

export interface DownloadResult {
  data: Uint8Array;
  mimeType: string;
}

export interface FindFileData {
  name: string;
  size: number;
  mimeType: string;
  expiryTime: number;
}

export interface RenewFileResult {
  renewed: boolean;
  previousExpiryTime: number;
  newExpiryTime: number;
}

// ============================================================================
// Vault Types
// ============================================================================

export interface VaultIndex {
  vaultId: string;
  userPublicKey: string;
  documents: VaultDocumentEntry[];
  lastSynced: number;
  indexUhrpUrl?: string;
}

export interface VaultDocumentEntry {
  path: string;
  uhrpUrl: string;
  keyId: string;
  lastModified: number;
  contentHash: string;
}

export interface VaultSyncStats {
  uploaded: number;
  updated: number;
  unchanged: number;
  errors: number;
}

export interface VaultProof {
  exists: boolean;
  uhrpUrl?: string;
  blockchainTxId?: string;
  timestamp?: number;
  blockHeight?: number;
}

// ============================================================================
// Shad Types
// ============================================================================

export interface ShadConfig {
  pythonPath?: string;
  shadPath?: string;
  maxDepth?: number;
  maxNodes?: number;
  maxTime?: number;
  strategy?: ShadStrategy;
  retriever?: 'auto' | 'qmd' | 'filesystem' | 'api';
}

export type ShadStrategy = 'software' | 'research' | 'analysis' | 'planning';

export interface ShadResult {
  success: boolean;
  output: string;
  retrievedDocuments: ShadRetrievedDocument[];
  executionTrace?: ShadExecutionTrace;
  error?: string;
}

export interface ShadRetrievedDocument {
  path: string;
  content: string;
  confidence: number;
  source: string;
}

export interface ShadExecutionTrace {
  runId: string;
  strategy: ShadStrategy;
  depth: number;
  nodes: number;
  durationMs: number;
}

export interface SecureRetrievalContext {
  userPublicKey: string;
  search: (query: string, limit?: number) => Promise<SearchResult[]>;
  readNote: (path: string) => Promise<string | null>;
  verifyDocument: (path: string) => Promise<VaultProof>;
}

export interface SearchResult {
  path: string;
  uhrpUrl: string;
  relevanceScore: number;
}

// ============================================================================
// Agent Identity Types
// ============================================================================

export interface AgentIdentity {
  publicKey: string;
  capabilities: string[];
  network: 'mainnet' | 'testnet';
}

export interface IdentityProof {
  signature: string;
  publicKey: string;
  data: string;
  timestamp: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthSession {
  sessionId: string;
  userPublicKey: string;
  createdAt: number;
  expiresAt: number;
  nonce: string;
  verified: boolean;
}

export interface AuthRequest {
  type: 'initialRequest' | 'initialResponse' | 'certificateRequest' | 'certificateResponse' | 'general';
  nonce?: string;
  yourNonce?: string;
  signature?: string;
  identityKey?: string;
  certificates?: Certificate[];
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditEntry {
  entryId: string;
  timestamp: number;
  action: string;
  userPublicKeyHash: string;
  agentPublicKey: string;
  inputHash: string;
  outputHash: string;
  signature: string;
  previousEntryHash: string;
  metadata?: Record<string, unknown>;
}

export interface AuditChain {
  entries: AuditEntry[];
  headHash: string;
  blockchainAnchors: BlockchainAnchor[];
}

export interface BlockchainAnchor {
  txId: string;
  blockHeight: number;
  timestamp: number;
  entryHashes: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

// AgentWalletConfig is defined in wallet/agent-wallet.ts
import type { AgentWalletConfig as WalletConfig } from '../wallet/agent-wallet.js';
export type { AgentWalletConfig } from '../wallet/agent-wallet.js';

export interface AGIdentityConfig {
  // Storage
  storageUrl: string;
  network?: 'mainnet' | 'testnet';

  // Agent wallet
  agentWallet: WalletConfig;

  // Shad integration
  shad?: ShadConfig;

  // Payment
  payment?: PaymentConfig;

  // Security
  security?: SecurityConfig;
}

export interface PaymentConfig {
  enabled?: boolean;
  pricePerRequest?: number;  // satoshis
  freeRequestsPerDay?: number;
  premiumFeatures?: string[];
}

export interface SecurityConfig {
  requireAuth?: boolean;
  allowUnauthenticated?: boolean;
  maxSessionDurationMs?: number;
  timingAnomalyThresholdMs?: number;
  auditToBlockchain?: boolean;
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface UserContext {
  userPublicKey: string;
  vaultId?: string;
  vaultInitialized: boolean;
  sessionCreatedAt: number;
  lastActivityAt: number;
}

export interface ToolExecutionContext {
  sessionKey?: string;
  agentId?: string;
  messageChannel?: string;
  sandboxed?: boolean;
}

// ============================================================================
// Team/Group Encryption Types (CurvePoint Integration)
// ============================================================================

/**
 * Represents a team member with their public key and role
 */
export interface TeamMember {
  publicKey: string;
  role: TeamRole;
  addedAt: number;
  addedBy: string;
  metadata?: TeamMemberMetadata;
}

/**
 * Team member roles with different access levels
 */
export type TeamRole = 'owner' | 'admin' | 'member' | 'readonly' | 'bot';

/**
 * Optional metadata for team members
 */
export interface TeamMemberMetadata {
  displayName?: string;
  email?: string;
  department?: string;
  customFields?: Record<string, string>;
}

/**
 * Security level for BRC-43 key derivation
 * 0 = public, 1 = app-wide, 2 = per-counterparty
 */
export type SecurityLevel = 0 | 1 | 2;

/**
 * Team configuration with encryption settings
 */
export interface TeamConfig {
  teamId: string;
  name: string;
  createdAt: number;
  createdBy: string;
  protocolID: [SecurityLevel, string];
  keyID: string;
  members: TeamMember[];
  parentTeamId?: string;  // For hierarchical teams
  settings?: TeamSettings;
}

/**
 * Team-specific settings
 */
export interface TeamSettings {
  allowMemberInvite?: boolean;
  requireAdminApproval?: boolean;
  maxMembers?: number;
  defaultMemberRole?: TeamRole;
  botAccessLevel?: TeamRole;
}

/**
 * Encrypted team document with group encryption header
 */
export interface TeamDocument {
  documentId: string;
  teamId: string;
  path: string;
  encryptedContent: number[];
  header: number[];  // CurvePoint group encryption header
  createdAt: number;
  createdBy: string;
  lastModifiedAt: number;
  lastModifiedBy: string;
  contentHash: string;
  metadata?: TeamDocumentMetadata;
}

/**
 * Team document metadata
 */
export interface TeamDocumentMetadata {
  filename?: string;
  mimeType?: string;
  description?: string;
  tags?: string[];
  version?: number;
}

/**
 * Team vault index for tracking all team documents
 */
export interface TeamVaultIndex {
  teamId: string;
  documents: TeamDocumentEntry[];
  lastSynced: number;
  indexUhrpUrl?: string;
}

/**
 * Entry in the team vault index
 */
export interface TeamDocumentEntry {
  documentId: string;
  path: string;
  uhrpUrl: string;
  keyId: string;
  lastModified: number;
  contentHash: string;
  createdBy: string;
}

/**
 * Result of team operations
 */
export interface TeamOperationResult {
  success: boolean;
  teamId: string;
  operation: 'create' | 'addMember' | 'removeMember' | 'storeDocument' | 'updateSettings';
  timestamp: number;
  error?: string;
}

/**
 * Team member access result
 */
export interface TeamAccessResult {
  hasAccess: boolean;
  role?: TeamRole;
  teamId?: string;
  error?: string;
}

/**
 * Team invitation for onboarding new members
 */
export interface TeamInvitation {
  invitationId: string;
  teamId: string;
  inviteePublicKey?: string;  // Optional: can be claimed by anyone with the invitation
  invitedBy: string;
  role: TeamRole;
  createdAt: number;
  expiresAt: number;
  claimed: boolean;
  claimedAt?: number;
  claimedBy?: string;
}

/**
 * Team activity audit entry
 */
export interface TeamAuditEntry {
  entryId: string;
  teamId: string;
  action: TeamAction;
  actorPublicKey: string;
  targetPublicKey?: string;  // For member-related actions
  documentId?: string;  // For document-related actions
  timestamp: number;
  details?: Record<string, unknown>;
  signature: string;
}

/**
 * Types of team actions for auditing
 */
export type TeamAction =
  | 'team_created'
  | 'member_added'
  | 'member_removed'
  | 'member_role_changed'
  | 'document_created'
  | 'document_updated'
  | 'document_deleted'
  | 'settings_changed'
  | 'team_deleted';

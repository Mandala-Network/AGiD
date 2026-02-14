/**
 * AGIdentity Core Types
 *
 * Type definitions for the AGIdentity system including wallet interfaces,
 * encryption contexts, and UHRP storage types.
 */

// Re-export OpenClaw plugin types
export * from './openclaw-plugin.js';

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

export interface AGIdentityConfig {
  // Storage
  storageUrl: string;
  network?: 'mainnet' | 'testnet';

  // Agent wallet
  agentWallet: AgentWalletConfig;

  // Shad integration
  shad?: ShadConfig;

  // Payment
  payment?: PaymentConfig;

  // Security
  security?: SecurityConfig;
}

export interface AgentWalletConfig {
  type: 'privateKey' | 'mnemonic' | 'external';
  privateKeyWif?: string;
  mnemonic?: string;
  externalWallet?: BRC100Wallet;
  storagePath?: string;
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

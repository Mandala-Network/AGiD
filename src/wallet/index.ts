export { AgentWallet, createAgentWallet } from './agent-wallet.js';
export {
  MPCAgentWallet,
  createMPCAgentWallet,
  type MPCAgentWalletConfig,
  type IMPCWallet,
  type MPCWalletFactory,
  type DKGProgressInfo,
  type MPCKeyId,
} from './mpc-agent-wallet.js';

// Production MPC integration
export {
  createProductionMPCWallet,
  loadMPCConfigFromEnv,
  type ProductionMPCConfig,
  type ProductionMPCWalletResult,
} from './mpc-integration.js';

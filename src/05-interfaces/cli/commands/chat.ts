/**
 * Chat command - connect to an agent and start conversation
 *
 * Connects to the local Babbage MetaNet Client desktop app via WalletClient
 * and delegates all signing/encryption to the local wallet.
 */

import { WalletClient } from '@bsv/sdk';
import { createMessageClient } from '../../../03-gateway/messaging/index.js';
import { startChatREPL } from '../repl/chat-repl.js';
import { formatError, showSpinner, success } from '../repl/display.js';

export interface ChatOptions {
  messageBox?: string;
  network?: string;
  host?: string;
}

export async function chatCommand(
  agentPublicKey: string,
  options: ChatOptions
): Promise<void> {
  // Validate agent public key
  if (!agentPublicKey || agentPublicKey.length < 66) {
    formatError(
      'Invalid agent public key. Expected a 66-character compressed public key.'
    );
    process.exit(1);
  }

  // Parse options
  const messageBox = options.messageBox || 'chat';
  const messageBoxHost =
    options.host ||
    process.env.MESSAGEBOX_HOST ||
    'https://messagebox.babbage.systems';

  const spinner = showSpinner('Connecting to MetaNet Client...');

  try {
    // Connect to local Babbage MetaNet Client via JSON-API substrate
    const walletClient = new WalletClient('json-api', 'agidentity');

    // Create a wallet adapter that satisfies AGIDMessageClient's MessageBoxWallet interface
    const walletAdapter = {
      getPublicKey: walletClient.getPublicKey.bind(walletClient),
      encrypt: walletClient.encrypt.bind(walletClient),
      decrypt: walletClient.decrypt.bind(walletClient),
      createSignature: walletClient.createSignature.bind(walletClient),
      verifySignature: walletClient.verifySignature.bind(walletClient),
      createHmac: walletClient.createHmac.bind(walletClient),
      verifyHmac: walletClient.verifyHmac.bind(walletClient),
      createAction: walletClient.createAction.bind(walletClient),
      acquireCertificate: walletClient.acquireCertificate.bind(walletClient),
      listCertificates: walletClient.listCertificates.bind(walletClient),
      getNetwork: walletClient.getNetwork.bind(walletClient),
      getHeight: walletClient.getHeight.bind(walletClient),
      // Provide the underlying wallet for MessageBoxClient/PeerPayClient construction
      getUnderlyingWallet: () => walletClient,
    };

    // Create message client
    const messageClient = createMessageClient({
      wallet: walletAdapter as any,
      messageBoxHost,
      enableLogging: false,
    });

    // Initialize
    await messageClient.initialize();

    const userPublicKey = messageClient.getIdentityKey();

    spinner.stop();
    console.log(success('Connected to MetaNet Client!'));

    // Start REPL
    await startChatREPL({
      messageClient,
      agentPublicKey,
      userPublicKey,
      messageBox,
    });

    // Cleanup
    await messageClient.disconnect();
  } catch (err) {
    spinner.stop();
    formatError(err);
    process.exit(1);
  }
}

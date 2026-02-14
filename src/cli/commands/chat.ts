/**
 * Chat command - connect to an agent and start conversation
 */

import { createAgentWallet } from '../../wallet/agent-wallet.js';
import { createMessageClient } from '../../messaging/index.js';
import { startChatREPL } from '../repl/chat-repl.js';
import { formatError, showSpinner, success } from '../repl/display.js';

export interface ChatOptions {
  messageBox?: string;
  timeout?: string;
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

  // Get private key from environment
  const privateKey = process.env.AGID_PRIVATE_KEY;

  if (!privateKey) {
    formatError(
      'AGID_PRIVATE_KEY environment variable not set.\n\n' +
        'Set it with:\n' +
        '  export AGID_PRIVATE_KEY=<64-character-hex-string>'
    );
    process.exit(1);
  }

  if (privateKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKey)) {
    formatError(
      'AGID_PRIVATE_KEY must be a 64-character hexadecimal string.'
    );
    process.exit(1);
  }

  // Parse options
  const network = (options.network || process.env.AGID_NETWORK || 'mainnet') as
    | 'mainnet'
    | 'testnet';
  const messageBox = options.messageBox || 'chat';
  const timeout = parseInt(options.timeout || '30000', 10);
  const messageBoxHost =
    options.host ||
    process.env.MESSAGEBOX_HOST ||
    'https://messagebox.babbage.systems';

  const spinner = showSpinner('Connecting...');

  try {
    // Create wallet with remote storage (no SQLite needed)
    const { wallet } = await createAgentWallet({
      privateKeyHex: privateKey,
      network,
      storageMode: 'remote',
    });

    // Create message client
    const messageClient = createMessageClient({
      wallet,
      messageBoxHost,
      enableLogging: false,
    });

    // Initialize
    await messageClient.initialize();

    const userPublicKey = messageClient.getIdentityKey();

    spinner.stop();
    console.log(success('Connected!'));

    // Start REPL
    await startChatREPL({
      messageClient,
      agentPublicKey,
      userPublicKey,
      messageBox,
      timeout,
    });

    // Cleanup
    await messageClient.disconnect();
    await wallet.destroy();
  } catch (err) {
    spinner.stop();
    formatError(err);
    process.exit(1);
  }
}

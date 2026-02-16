/**
 * Info command - display identity information
 */

import { PrivateKey } from '@bsv/sdk';
import { printHeader, printKeyValue, formatError, dim } from '../repl/display.js';

export interface InfoOptions {
  network?: string;
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  const privateKeyHex = process.env.AGID_PRIVATE_KEY;

  if (!privateKeyHex) {
    formatError(
      'AGID_PRIVATE_KEY environment variable not set.\n\n' +
        'Set it with:\n' +
        '  export AGID_PRIVATE_KEY=<64-character-hex-string>'
    );
    process.exit(1);
  }

  if (privateKeyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
    formatError(
      'AGID_PRIVATE_KEY must be a 64-character hexadecimal string.'
    );
    process.exit(1);
  }

  const network = (options.network || process.env.AGID_NETWORK || 'mainnet') as
    | 'mainnet'
    | 'testnet';

  try {
    // Derive public key directly from private key
    const privateKey = PrivateKey.fromHex(privateKeyHex);
    const publicKey = privateKey.toPublicKey().toString();

    printHeader('AGIdentity Info');
    printKeyValue('Identity', publicKey);
    printKeyValue('Network', network);
    printKeyValue('MessageBox', process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems');
    console.log();
    console.log(dim('Use this identity key to receive messages from other users.'));
    console.log();
  } catch (err) {
    formatError(err);
    process.exit(1);
  }
}

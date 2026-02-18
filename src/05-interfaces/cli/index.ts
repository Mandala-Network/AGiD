#!/usr/bin/env node

/**
 * AGIdentity CLI
 *
 * Connect to AI agents via encrypted MessageBox communication.
 */

import { Command } from 'commander';
import { infoCommand } from './commands/info.js';
import { chatCommand } from './commands/chat.js';

const program = new Command();

program
  .name('agid')
  .description('AGIdentity CLI - Connect to AI agents via encrypted messaging')
  .version('0.1.0');

// Info command
program
  .command('info')
  .description('Display identity information')
  .option('-n, --network <network>', 'Network: mainnet or testnet', 'mainnet')
  .action(infoCommand);

// Chat command
program
  .command('chat')
  .description('Start a chat session with an agent (connects to local MetaNet Client)')
  .argument('<agent-pubkey>', 'Agent public key (66 hex chars)')
  .option('-m, --message-box <name>', 'Message box name', 'chat')
  .option('-h, --host <url>', 'MessageBox host URL')
  .action(chatCommand);

// Parse and execute
program.parse();

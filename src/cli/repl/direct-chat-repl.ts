/**
 * Direct Chat REPL — calls the agent loop in-process, no MessageBox.
 *
 * Used when the gateway and REPL run in the same process (npx tsx src/start.ts).
 * Eliminates MessageBox polling, encryption, and network round-trips.
 */

import * as readline from 'readline';
import type { AGIdentityGateway } from '../../gateway/agidentity-gateway.js';
import {
  formatAgentResponse,
  formatError,
  showSpinner,
  dim,
  bold,
} from './display.js';

export interface DirectChatREPLConfig {
  gateway: AGIdentityGateway;
  userPublicKey: string;
}

/**
 * Start a direct chat REPL (no MessageBox round-trip).
 * Returns a promise that resolves when the user exits.
 */
export function startDirectChatREPL(config: DirectChatREPLConfig): Promise<void> {
  const { gateway, userPublicKey } = config;
  const agentPublicKey = gateway.getAgentPublicKey() ?? 'unknown';

  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: bold('> '),
    });

    console.log();
    console.log(`Connected to agent ${dim(agentPublicKey.slice(0, 16) + '...')} (direct mode)`);
    console.log(`Type your message or ${dim('/quit')} to exit.`);
    console.log();

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      // Handle commands
      if (input.startsWith('/')) {
        const [command] = input.slice(1).split(' ');
        switch (command.toLowerCase()) {
          case 'quit':
          case 'exit':
          case 'q':
            rl.close();
            return;
          case 'help':
          case 'h':
            console.log();
            console.log('Commands:');
            console.log('  /quit, /exit, /q  - Exit the chat');
            console.log('  /help, /h         - Show this help');
            console.log('  /clear            - Clear the screen');
            console.log();
            rl.prompt();
            return;
          case 'clear':
            console.clear();
            rl.prompt();
            return;
          default:
            console.log(dim(`Unknown command: ${command}. Type /help for commands.`));
            rl.prompt();
            return;
        }
      }

      // Call agent loop directly
      const spinner = showSpinner('Thinking...');

      try {
        const response = await gateway.chat(input, userPublicKey);
        spinner.stop();
        formatAgentResponse(response);
      } catch (err) {
        spinner.stop();
        formatError(err);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      resolve();
    });

    rl.on('SIGINT', () => {
      rl.close();
    });
  });
}

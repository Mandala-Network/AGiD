/**
 * Interactive chat REPL
 */

import * as readline from 'readline';
import type { AGIDMessageClient, AGIDMessage } from '../../messaging/index.js';
import {
  createChatRequest,
  isResponseTo,
  isErrorFor,
  type ChatRequest,
  type ChatResponse,
  type ChatMessage,
} from '../types.js';
import {
  formatAgentResponse,
  formatError,
  formatInfo,
  showSpinner,
  dim,
  bold,
} from './display.js';

export interface ChatREPLConfig {
  messageClient: AGIDMessageClient;
  agentPublicKey: string;
  userPublicKey: string;
  messageBox: string;
}

/**
 * Start interactive chat REPL
 */
export async function startChatREPL(config: ChatREPLConfig): Promise<void> {
  const { messageClient, agentPublicKey, userPublicKey, messageBox } =
    config;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold('> '),
  });

  console.log();
  console.log(`Connected to agent ${dim(agentPublicKey.slice(0, 16) + '...')}`);
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
      const handled = await handleCommand(input, rl);
      if (handled) {
        rl.prompt();
      }
      return;
    }

    // Send message
    const spinner = showSpinner('Waiting for response...');

    try {
      const request = createChatRequest(input, userPublicKey);
      const response = await sendAndWaitForResponse(
        messageClient,
        agentPublicKey,
        messageBox,
        request
      );

      spinner.stop();
      formatAgentResponse(response.content);
    } catch (err) {
      spinner.stop();
      formatError(err);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    rl.close();
  });
}

/**
 * Handle slash commands
 */
async function handleCommand(
  input: string,
  rl: readline.Interface
): Promise<boolean> {
  const [command] = input.slice(1).split(' ');

  switch (command.toLowerCase()) {
    case 'quit':
    case 'exit':
    case 'q':
      rl.close();
      return false;

    case 'help':
    case 'h':
      console.log();
      console.log('Commands:');
      console.log('  /quit, /exit, /q  - Exit the chat');
      console.log('  /help, /h         - Show this help');
      console.log('  /clear            - Clear the screen');
      console.log();
      return true;

    case 'clear':
      console.clear();
      return true;

    default:
      formatInfo(`Unknown command: ${command}. Type /help for commands.`);
      return true;
  }
}

/**
 * Send message and wait for response
 */
async function sendAndWaitForResponse(
  messageClient: AGIDMessageClient,
  agentPublicKey: string,
  messageBox: string,
  request: ChatRequest
): Promise<ChatResponse> {
  // Send the request (auto-encrypted by MessageBox)
  await messageClient.sendMessage(agentPublicKey, messageBox, request);

  // Poll for response (no timeout - wait until agent responds or user cancels)
  return new Promise((resolve, reject) => {
    const pollInterval = 1000; // 1 second

    const poll = async () => {
      try {
        // No timeout - wait indefinitely for the agent to respond.
        // The agent may use tools, sign transactions, etc. which takes time.
        // User can Ctrl+C to cancel.

        // List messages in our inbox
        const messages = await messageClient.listMessages(messageBox);

        // Find response to our request
        for (const msg of messages) {
          const body = parseMessageBody(msg);
          if (!body) continue;

          if (isResponseTo(body, request.id)) {
            // Acknowledge and remove the message
            await messageClient.acknowledgeMessage(msg.messageId);
            resolve(body as ChatResponse);
            return;
          }

          if (isErrorFor(body, request.id)) {
            await messageClient.acknowledgeMessage(msg.messageId);
            reject(new Error(body.error.message));
            return;
          }
        }

        // Continue polling
        setTimeout(poll, pollInterval);
      } catch (err) {
        // Transient error, continue polling
        setTimeout(poll, pollInterval);
      }
    };

    poll();
  });
}

/**
 * Parse message body safely
 */
function parseMessageBody(msg: AGIDMessage): ChatMessage | null {
  try {
    if (typeof msg.body === 'string') {
      return JSON.parse(msg.body) as ChatMessage;
    }
    // Validate it has a type field before casting
    const body = msg.body as Record<string, unknown>;
    if (body && typeof body.type === 'string') {
      return body as unknown as ChatMessage;
    }
    return null;
  } catch {
    return null;
  }
}

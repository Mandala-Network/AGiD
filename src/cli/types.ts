/**
 * CLI Message Types
 *
 * Protocol for communication between CLI users and agents via MessageBox.
 */

/**
 * Chat request sent from user to agent
 */
export interface ChatRequest {
  type: 'chat_request';
  id: string;
  timestamp: number;
  content: string;
  sender: string;
}

/**
 * Chat response sent from agent to user
 */
export interface ChatResponse {
  type: 'chat_response';
  id: string;
  requestId: string;
  timestamp: number;
  content: string;
  agent: string;
}

/**
 * Error response
 */
export interface ChatError {
  type: 'chat_error';
  requestId?: string;
  timestamp: number;
  error: {
    code: string;
    message: string;
  };
}

export type ChatMessage = ChatRequest | ChatResponse | ChatError;

/**
 * CLI configuration
 */
export interface CLIConfig {
  privateKey: string;
  network: 'mainnet' | 'testnet';
  messageBoxHost: string;
  timeout: number;
}

/**
 * Create a chat request
 */
export function createChatRequest(
  content: string,
  senderPublicKey: string
): ChatRequest {
  return {
    type: 'chat_request',
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    content,
    sender: senderPublicKey,
  };
}

/**
 * Check if message is a response to a specific request
 */
export function isResponseTo(
  message: ChatMessage,
  requestId: string
): message is ChatResponse {
  return (
    message.type === 'chat_response' &&
    (message as ChatResponse).requestId === requestId
  );
}

/**
 * Check if message is an error for a specific request
 */
export function isErrorFor(
  message: ChatMessage,
  requestId: string
): message is ChatError {
  return (
    message.type === 'chat_error' &&
    (message as ChatError).requestId === requestId
  );
}

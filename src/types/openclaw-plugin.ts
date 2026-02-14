/**
 * OpenClaw Plugin Types
 *
 * These types define the interface for OpenClaw plugins.
 * When openclaw is installed as a peer dependency, these should match
 * the types from 'openclaw/plugin-sdk'.
 */

export interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;

  registerTool: (
    tool: AgentTool,
    opts?: { name?: string }
  ) => void;

  registerHook?: (
    events: string | string[],
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number }
  ) => void;

  registerHttpRoute?: (params: { path: string; handler: HttpHandler }) => void;

  registerCli?: (registrar: CliRegistrar, opts?: { commands?: string[] }) => void;

  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandler,
    opts?: { priority?: number }
  ) => void;
}

export type PluginHookName =
  | 'before_agent_start'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'before_reset'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop';

export type PluginHookHandler = (
  event: PluginHookEvent,
  ctx: PluginHookContext
) => Promise<PluginHookResult | void> | PluginHookResult | void;

export interface PluginHookEvent {
  prompt?: string;
  messages?: unknown[];
  success?: boolean;
  error?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface PluginHookContext {
  sessionKey?: string;
  agentId?: string;
  workspaceDir?: string;
  [key: string]: unknown;
}

export interface PluginHookResult {
  systemPrompt?: string;
  prependContext?: string;
  [key: string]: unknown;
}

export interface OpenClawPluginDefinition {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  configSchema?: unknown;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
}

export interface OpenClawConfig {
  [key: string]: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required: string[];
  };
  execute: ToolExecuteFunction;
}

export type ToolExecuteFunction = (
  toolId: string,
  params: Record<string, unknown>,
  ctx?: ToolContext
) => Promise<ToolResult> | ToolResult;

export interface ToolContext {
  sessionKey?: string;
  agentId?: string;
  messageChannel?: string;
  sandboxed?: boolean;
}

export interface ToolResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export type HttpHandler = (
  req: HttpRequest,
  res: HttpResponse
) => Promise<void> | void;

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  auth?: { identityKey: string };
}

export interface HttpResponse {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  json: (data: unknown) => void;
  status: (code: number) => HttpResponse;
}

export type CliRegistrar = (ctx: CliContext) => void | Promise<void>;

export interface CliContext {
  program: CliProgram;
  config: OpenClawConfig;
  workspaceDir?: string;
  logger: PluginLogger;
}

export interface CliProgram {
  command: (name: string) => CliCommand;
}

export interface CliCommand {
  description: (desc: string) => CliCommand;
  option: (flags: string, desc: string) => CliCommand;
  requiredOption: (flags: string, desc: string) => CliCommand;
  action: (handler: (...args: unknown[]) => void | Promise<void>) => CliCommand;
}

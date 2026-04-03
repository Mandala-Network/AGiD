/**
 * Plugin System Types
 *
 * OpenClaw-compatible plugin definitions with AGiD extensions.
 */

// ---------------------------------------------------------------------------
// Tool Result (OpenClaw-compatible)
// ---------------------------------------------------------------------------

export interface PluginToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // TypeBox or JSON Schema
  requiresWallet?: boolean;
  auditable?: boolean;
  execute(id: string, params: any, ctx?: ToolExecutionContext): Promise<PluginToolResult>;
}

export interface ToolRegistrationOptions {
  optional?: boolean;
  group?: string;
}

export interface ToolExecutionContext {
  wallet?: any;
  audit?: any;
}

// ---------------------------------------------------------------------------
// Plugin API (passed to register())
// ---------------------------------------------------------------------------

export interface PluginAPI {
  registerTool(tool: ToolRegistration, options?: ToolRegistrationOptions): void;
  config?: Record<string, any>;
  agid?: AGiDExtensions;
}

export interface AGiDExtensions {
  wallet: any;
  audit: any;
  identity: any;
  memoryManager?: any;
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export interface PluginDefinition {
  id: string;
  name: string;
  register(api: PluginAPI): void;
  destroy?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Manifest (agid.plugin.json / openclaw.plugin.json)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  configSchema?: Record<string, unknown>;
  skills?: string[];
}

// ---------------------------------------------------------------------------
// Loaded Plugin (runtime state)
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  manifest: PluginManifest;
  definition: PluginDefinition;
  tools: Map<string, RegisteredPluginTool>;
  rootPath: string;
}

export interface RegisteredPluginTool {
  registration: ToolRegistration;
  options: ToolRegistrationOptions;
  pluginId: string;
}

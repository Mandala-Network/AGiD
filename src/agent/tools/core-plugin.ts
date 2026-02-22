import type { ToolPlugin } from './types.js';
import { createAllTools } from './index.js';

export const corePlugin: ToolPlugin = {
  name: 'agid-core',
  version: '0.1.0',
  description: 'Built-in AGIdentity tools',
  createTools: (ctx) => createAllTools(ctx),
};

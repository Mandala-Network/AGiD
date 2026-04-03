import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidFsPlugin } from '../../../plugins/builtin/agid-fs.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('agid-fs plugin', () => {
  it('registers 4 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('apply_patch');
  });

  it('tools are in the fs group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('fs');
    }
  });

  it('no tool requires wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.registration.requiresWallet).toBe(false);
    }
  });
});

describe('agid-fs path safety', () => {
  let registry: PluginRegistry;
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agid-fs-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects paths that traverse above cwd with ../', async () => {
    const result = await registry.executeTool('read', { path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Path escapes working directory/);
  });

  it('rejects absolute paths outside cwd', async () => {
    const result = await registry.executeTool('read', { path: '/etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Path escapes working directory/);
  });

  it('allows paths within cwd', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello', 'utf8');
    const result = await registry.executeTool('read', { path: 'test.txt' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.content).toContain('hello');
  });

  it('edit replace_all does not infinite-loop when newString contains oldString', async () => {
    await fs.writeFile(path.join(tmpDir, 'loop.txt'), 'aaa', 'utf8');
    const result = await registry.executeTool('edit', {
      path: 'loop.txt',
      old_string: 'a',
      new_string: 'aa',
      replace_all: true,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.replacements).toBe(3);
    const content = await fs.readFile(path.join(tmpDir, 'loop.txt'), 'utf8');
    expect(content).toBe('aaaaaa');
  });
});

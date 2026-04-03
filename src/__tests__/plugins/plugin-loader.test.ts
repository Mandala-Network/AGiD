import { describe, it, expect } from 'vitest';
import { readManifest, discoverPlugins } from '../../plugins/plugin-loader.js';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('readManifest', () => {
  it('reads agid.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), JSON.stringify({
      id: 'test-plugin',
      name: 'Test',
    }));
    const manifest = await readManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe('test-plugin');
  });

  it('falls back to openclaw.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({
      id: 'oc-plugin',
      name: 'OpenClaw Plugin',
    }));
    const manifest = await readManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe('oc-plugin');
  });

  it('prefers agid.plugin.json over openclaw.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), JSON.stringify({ id: 'agid-version' }));
    await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: 'oc-version' }));
    const manifest = await readManifest(dir);
    expect(manifest!.id).toBe('agid-version');
  });

  it('returns null when no manifest found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    const manifest = await readManifest(dir);
    expect(manifest).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), 'not json');
    const manifest = await readManifest(dir);
    expect(manifest).toBeNull();
  });
});

describe('discoverPlugins', () => {
  it('discovers plugins in a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugins-'));
    const pluginDir = join(dir, 'my-plugin');
    await mkdir(pluginDir);
    await writeFile(join(pluginDir, 'agid.plugin.json'), JSON.stringify({ id: 'my-plugin' }));
    const discovered = await discoverPlugins([dir]);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].manifest.id).toBe('my-plugin');
  });

  it('skips directories without manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugins-'));
    const noManifest = join(dir, 'no-manifest');
    await mkdir(noManifest);
    const discovered = await discoverPlugins([dir]);
    expect(discovered).toHaveLength(0);
  });

  it('handles nonexistent directories gracefully', async () => {
    const discovered = await discoverPlugins(['/tmp/nonexistent-dir-12345']);
    expect(discovered).toHaveLength(0);
  });
});

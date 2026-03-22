/**
 * Plugin Loader
 *
 * Discovers plugins from configured directories,
 * reads manifests (agid.plugin.json or openclaw.plugin.json),
 * and loads plugin modules via dynamic import.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { PluginManifest, PluginDefinition } from './types.js';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  rootPath: string;
}

/**
 * Read a plugin manifest from a directory.
 * Prefers agid.plugin.json, falls back to openclaw.plugin.json.
 */
export async function readManifest(dir: string): Promise<PluginManifest | null> {
  for (const filename of ['agid.plugin.json', 'openclaw.plugin.json']) {
    try {
      const content = await readFile(join(dir, filename), 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;
      if (!manifest.id) {
        console.warn(`[PluginLoader] Manifest at ${join(dir, filename)} missing 'id' — skipping`);
        return null;
      }
      return manifest;
    } catch {
      // File not found or invalid — try next
    }
  }
  return null;
}

/**
 * Discover plugins in a list of directories.
 * Each subdirectory with a valid manifest is a plugin candidate.
 */
export async function discoverPlugins(dirs: string[]): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const pluginPath = join(dir, entry);
      try {
        const s = await stat(pluginPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const manifest = await readManifest(pluginPath);
      if (manifest) {
        discovered.push({ manifest, rootPath: pluginPath });
      }
    }
  }

  return discovered;
}

/**
 * Load a plugin module from a discovered plugin.
 * Reads package.json for the entry point (agid.extensions or openclaw.extensions),
 * then dynamically imports the module.
 */
export async function loadPluginModule(
  discovered: DiscoveredPlugin,
): Promise<PluginDefinition | null> {
  let entryPoint: string | null = null;

  try {
    const pkgJson = JSON.parse(await readFile(join(discovered.rootPath, 'package.json'), 'utf-8'));
    const extensions = pkgJson.agid?.extensions ?? pkgJson.openclaw?.extensions;
    if (extensions && extensions.length > 0) {
      entryPoint = extensions[0];
    }
  } catch {
    // No package.json
  }

  if (!entryPoint) {
    for (const candidate of ['./index.ts', './index.js', './dist/index.js']) {
      try {
        await stat(join(discovered.rootPath, candidate));
        entryPoint = candidate;
        break;
      } catch {
        continue;
      }
    }
  }

  if (!entryPoint) {
    console.warn(`[PluginLoader] No entry point found for plugin '${discovered.manifest.id}' at ${discovered.rootPath}`);
    return null;
  }

  try {
    const modulePath = join(discovered.rootPath, entryPoint);
    const mod = await import(modulePath);
    return mod.default ?? mod;
  } catch (error) {
    console.error(`[PluginLoader] Failed to load plugin '${discovered.manifest.id}':`, error);
    return null;
  }
}

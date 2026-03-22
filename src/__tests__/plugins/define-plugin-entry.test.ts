import { describe, it, expect } from 'vitest';
import { definePluginEntry } from '../../plugins/define-plugin-entry.js';

describe('definePluginEntry', () => {
  it('returns the plugin definition unchanged', () => {
    const def = definePluginEntry({
      id: 'test-plugin',
      name: 'Test Plugin',
      register(_api) {},
    });
    expect(def.id).toBe('test-plugin');
    expect(def.name).toBe('Test Plugin');
    expect(typeof def.register).toBe('function');
  });

  it('supports optional destroy hook', () => {
    const def = definePluginEntry({
      id: 'test-plugin',
      name: 'Test Plugin',
      register(_api) {},
      async destroy() {},
    });
    expect(typeof def.destroy).toBe('function');
  });
});

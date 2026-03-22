/**
 * AGiD Optimize Plugin
 *
 * GEPA prompt optimization tool.
 */

import { GepaExecutor } from '../../integrations/gepa/index.js';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidOptimizePlugin = definePluginEntry({
  id: 'agid-optimize',
  name: 'AGiD Optimize',
  register(api) {
    api.registerTool({
      name: 'agid_optimize_prompt',
      description: 'Optimize any text or prompt using GEPA evolutionary optimization.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text or prompt to optimize' },
          objective: { type: 'string', description: 'What the optimized text should achieve' },
          mode: { type: 'string', description: '"fast" (10 iterations) or "thorough" (30 iterations). Default: fast' },
        },
        required: ['text', 'objective'],
      },
      async execute(_id, params) {
        const text = params.text as string;
        const objective = params.objective as string;
        const mode = (params.mode as string) || 'fast';
        const maxIterations = mode === 'thorough' ? 30 : 10;

        const executor = new GepaExecutor();
        const availability = await executor.checkGepaAvailable();

        if (!availability.available) {
          return json({
            original: text,
            optimized: null,
            gepaAvailable: false,
            error: availability.error ?? 'gepa not installed',
          });
        }

        const result = await executor.optimize({ text, objective, maxIterations });

        if (!result.success) {
          return json({ original: text, optimized: null, gepaAvailable: true, error: result.error });
        }

        return json({
          original: text,
          optimized: result.optimizedText,
          reasoning: result.reasoning,
          iterations: result.iterations,
          gepaAvailable: true,
        });
      },
    });
  },
});

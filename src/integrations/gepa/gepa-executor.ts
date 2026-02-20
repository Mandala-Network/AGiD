/**
 * GEPA Executor
 *
 * Executes GEPA prompt optimization via Python subprocess.
 * Follows the ShadTempVaultExecutor pattern: subprocess + secure temp dir.
 *
 * @module agidentity/gepa
 */

import { spawn } from 'child_process';
import { mkdtemp, chmod, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface GepaOptimizeParams {
  text: string;
  objective: string;
  maxIterations?: number;
}

export interface GepaResult {
  success: boolean;
  optimizedText?: string;
  reasoning?: string;
  iterations?: number;
  error?: string;
}

export interface GepaAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

export interface GepaExecutorConfig {
  pythonPath?: string;
  timeout?: number;
}

/**
 * GEPA Executor — optimizes text/prompts using GEPA's evolutionary optimize_anything API.
 *
 * Uses Python subprocess with JSON stdin/stdout for cross-language interop.
 * Secure temp dir (0o700) with always-cleanup in finally block.
 */
export class GepaExecutor {
  private readonly pythonPath: string;
  private readonly timeout: number;

  constructor(config?: GepaExecutorConfig) {
    this.pythonPath = config?.pythonPath ?? process.env.AGID_GEPA_PYTHON_PATH ?? 'python3';
    this.timeout = config?.timeout ?? parseInt(process.env.AGID_GEPA_TIMEOUT ?? '60', 10);
  }

  /**
   * Check if GEPA is installed and available
   */
  async checkGepaAvailable(): Promise<GepaAvailability> {
    return new Promise((resolve) => {
      const proc = spawn(this.pythonPath, ['-c', 'from importlib.metadata import version; print(version("gepa"))']);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, version: stdout.trim() });
        } else {
          resolve({ available: false, error: stderr || 'gepa not installed' });
        }
      });

      proc.on('error', (error) => {
        resolve({ available: false, error: `Failed to check GEPA: ${error.message}` });
      });

      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ available: false, error: 'GEPA availability check timed out' });
      }, 10000);
    });
  }

  /**
   * Optimize text using GEPA's evolutionary optimization
   */
  async optimize(params: GepaOptimizeParams): Promise<GepaResult> {
    const maxIterations = params.maxIterations ?? 10;

    // Create secure temp directory
    const tempDir = await mkdtemp(join(tmpdir(), 'agid-gepa-'));
    await chmod(tempDir, 0o700);

    try {
      // Write inline Python script
      const script = buildGepaScript();
      const scriptPath = join(tempDir, 'gepa_optimize.py');
      await writeFile(scriptPath, script, { encoding: 'utf-8', mode: 0o600 });

      // Prepare input as JSON
      const input = JSON.stringify({
        text: params.text,
        objective: params.objective,
        max_iterations: maxIterations,
      });

      return await this.runScript(scriptPath, input);
    } finally {
      // ALWAYS cleanup (security critical)
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Cleanup errors shouldn't break execution
      }
    }
  }

  private runScript(scriptPath: string, input: string): Promise<GepaResult> {
    return new Promise((resolve) => {
      const proc = spawn(this.pythonPath, [scriptPath], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.stdin.write(input);
      proc.stdin.end();

      proc.on('close', (code) => {
        if (code !== 0) {
          if (stderr.includes('No module named') || stderr.includes('ModuleNotFoundError')) {
            resolve({ success: false, error: 'gepa not installed. Install with: pip install gepa' });
            return;
          }
          resolve({ success: false, error: `GEPA exited with code ${code}: ${stderr}` });
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            success: true,
            optimizedText: result.optimized_text,
            reasoning: result.reasoning,
            iterations: result.iterations,
          });
        } catch {
          resolve({ success: false, error: `Failed to parse GEPA output: ${stdout}` });
        }
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: `Failed to start GEPA: ${error.message}` });
      });

      // Timeout kill
      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ success: false, error: `GEPA optimization timed out after ${this.timeout}s` });
      }, this.timeout * 1000);
    });
  }
}

function buildGepaScript(): string {
  return `
import sys
import json

def main():
    input_data = json.loads(sys.stdin.read())
    text = input_data["text"]
    objective = input_data["objective"]
    max_iterations = input_data.get("max_iterations", 10)

    from gepa.optimize_anything import optimize_anything, GEPAConfig, EngineConfig

    def evaluator_fn(candidate: str) -> float:
        \"\"\"LLM-as-judge scoring against the objective.\"\"\"
        # GEPA's built-in LLM evaluator scores candidates 0-1
        # by checking alignment with the objective
        prompt = (
            f"Rate how well this text achieves the objective on a scale of 0.0 to 1.0.\\n\\n"
            f"Objective: {objective}\\n\\n"
            f"Text: {candidate}\\n\\n"
            f"Score (0.0-1.0):"
        )
        try:
            from gepa.llm import ask_llm
            response = ask_llm(prompt)
            # Extract numeric score
            for token in response.split():
                try:
                    score = float(token.strip().rstrip('.'))
                    if 0.0 <= score <= 1.0:
                        return score
                except ValueError:
                    continue
            return 0.5
        except Exception:
            return 0.5

    result = optimize_anything(
        seed_candidate=text,
        evaluator=evaluator_fn,
        objective=objective,
        config=GEPAConfig(engine=EngineConfig(max_metric_calls=max_iterations)),
    )

    output = {
        "optimized_text": result.best_candidate if hasattr(result, "best_candidate") else str(result),
        "reasoning": result.reasoning if hasattr(result, "reasoning") else None,
        "iterations": result.iterations if hasattr(result, "iterations") else max_iterations,
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
`.trimStart();
}

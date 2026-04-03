/**
 * AGiD Runtime Plugin
 *
 * Tools for running shell commands and managing background processes.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

interface BackgroundSession {
  proc: import('child_process').ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const sessions = new Map<string, BackgroundSession>();

const DENIED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+.*\/|.*-rf\s|.*-fr\s)/,  // rm -rf, rm -fr
  /\bcurl\b.*\|\s*(sh|bash|zsh)/,                             // curl | sh
  /\bwget\b.*\|\s*(sh|bash|zsh)/,                             // wget | sh
  /\bwget\b.*-O\s*-.*\|\s*(sh|bash|zsh)/,                     // wget -O - | bash
  /\bmkfs\b/,                                                  // mkfs.*
  /\bdd\b.*if=\/dev\/(zero|random|urandom).*of=\/dev\//,      // dd wipe disk
  /\bchmod\b.*-R\s+777\s+\//,                                 // chmod -R 777 /
  />\s*\/dev\/sd[a-z]/,                                        // redirect to block device
];

function isCommandBlocked(command: string): boolean {
  return DENIED_PATTERNS.some(pattern => pattern.test(command));
}

export const agidRuntimePlugin = definePluginEntry({
  id: 'agid-runtime',
  name: 'AGiD Runtime',
  register(api) {
    api.registerTool(
      {
        name: 'exec',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            workdir: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Additional environment variables' },
            timeout: { type: 'number', description: 'Timeout in seconds (default 120)' },
            background: { type: 'boolean', description: 'Run in background' },
          },
          required: ['command'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const command = params.command as string;
          if (isCommandBlocked(command)) {
            return json({ error: 'Command blocked: matches a destructive pattern. Refusing to execute.' });
          }
          const workdir = (params.workdir as string) || process.cwd();
          const env = params.env as Record<string, string> | undefined;
          const timeout = ((params.timeout as number) || 120) * 1000;
          const background = params.background as boolean;

          const spawnEnv = env ? { ...process.env, ...env } : process.env;

          if (background) {
            const sessionId = randomUUID();
            const proc = spawn(command, [], {
              shell: true,
              cwd: workdir,
              env: spawnEnv,
            });

            const session: BackgroundSession = {
              proc,
              stdout: '',
              stderr: '',
              exitCode: null,
            };

            proc.stdout?.on('data', (chunk: Buffer) => {
              session.stdout += chunk.toString();
            });
            proc.stderr?.on('data', (chunk: Buffer) => {
              session.stderr += chunk.toString();
            });
            proc.on('close', (code) => {
              session.exitCode = code;
            });

            // Timeout for background processes
            setTimeout(() => {
              if (session.exitCode === null) {
                proc.kill('SIGKILL');
              }
            }, timeout);

            sessions.set(sessionId, session);
            return json({ sessionId, status: 'running' });
          }

          // Foreground execution
          return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            const proc = spawn(command, [], {
              shell: true,
              cwd: workdir,
              env: spawnEnv,
            });

            proc.stdout?.on('data', (chunk: Buffer) => {
              stdout += chunk.toString();
            });
            proc.stderr?.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });

            const timer = setTimeout(() => {
              proc.kill('SIGKILL');
            }, timeout);

            proc.on('close', (exitCode) => {
              clearTimeout(timer);
              resolve(json({ stdout, stderr, exitCode: exitCode ?? 1 }));
            });

            proc.on('error', (err) => {
              clearTimeout(timer);
              resolve(json({ stdout, stderr, exitCode: 1, error: err.message }));
            });
          });
        },
      },
      { group: 'runtime' },
    );

    api.registerTool(
      {
        name: 'process',
        description: 'Manage background processes started by exec',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'Action to perform',
              enum: ['poll', 'send-keys', 'submit', 'paste'],
            },
            sessionId: { type: 'string', description: 'Background session ID' },
            keys: { type: 'string', description: 'Keys to send (for send-keys)' },
            text: { type: 'string', description: 'Text to send (for paste/submit)' },
          },
          required: ['action', 'sessionId'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const action = params.action as string;
          const sessionId = params.sessionId as string;
          const keys = params.keys as string | undefined;
          const text = params.text as string | undefined;

          const session = sessions.get(sessionId);
          if (!session) {
            return json({ error: `No session found: ${sessionId}` });
          }

          const status = session.exitCode === null ? 'running' : 'exited';

          switch (action) {
            case 'poll': {
              const output = { stdout: session.stdout, stderr: session.stderr };
              session.stdout = '';
              session.stderr = '';
              return json({
                sessionId,
                status,
                ...(session.exitCode !== null ? { exitCode: session.exitCode } : {}),
                output,
              });
            }
            case 'send-keys': {
              if (keys !== undefined && session.proc.stdin) {
                session.proc.stdin.write(keys);
              }
              return json({ sessionId, status });
            }
            case 'submit': {
              if (text !== undefined && session.proc.stdin) {
                session.proc.stdin.write(text + '\n');
              }
              return json({ sessionId, status });
            }
            case 'paste': {
              if (text !== undefined && session.proc.stdin) {
                session.proc.stdin.write(text);
              }
              return json({ sessionId, status });
            }
            default:
              return json({ error: `Unknown action: ${action}` });
          }
        },
      },
      { group: 'runtime' },
    );
  },
});

/**
 * AGiD FS Plugin
 *
 * Tools for reading, writing, editing, and patching files.
 */

import * as fs from 'fs/promises';
import * as nodePath from 'path';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function resolveSafePath(filePath: string): string {
  const cwd = process.cwd();
  const resolved = nodePath.resolve(cwd, filePath);
  const relative = nodePath.relative(cwd, resolved);
  if (relative.startsWith('..') || !resolved.startsWith(cwd)) {
    throw new Error(`Path escapes working directory: ${filePath}`);
  }
  return resolved;
}

export const agidFsPlugin = definePluginEntry({
  id: 'agid-fs',
  name: 'AGiD FS',
  register(api) {
    // -----------------------------------------------------------------------
    // read
    // -----------------------------------------------------------------------
    api.registerTool(
      {
        name: 'read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
            offset: { type: 'number', description: '1-based line offset to start reading from' },
            limit: { type: 'number', description: 'Maximum number of lines to return' },
          },
          required: ['path'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const filePath = resolveSafePath(params.path as string);
          const raw = await fs.readFile(filePath, 'utf8');
          let lines = raw.split('\n');

          const offset = (params.offset as number | undefined) ?? 1;
          const limit = params.limit as number | undefined;

          const startIndex = Math.max(0, offset - 1);
          if (limit !== undefined) {
            lines = lines.slice(startIndex, startIndex + limit);
          } else {
            lines = lines.slice(startIndex);
          }

          const numbered = lines.map((line, i) => `${startIndex + i + 1}\t${line}`).join('\n');
          return json({ path: filePath, content: numbered });
        },
      },
      { group: 'fs' },
    );

    // -----------------------------------------------------------------------
    // write
    // -----------------------------------------------------------------------
    api.registerTool(
      {
        name: 'write',
        description: 'Write or create a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const filePath = resolveSafePath(params.path as string);
          const content = params.content as string;
          await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, 'utf8');
          const bytes = Buffer.byteLength(content, 'utf8');
          return json({ path: filePath, bytes, written: true });
        },
      },
      { group: 'fs' },
    );

    // -----------------------------------------------------------------------
    // edit
    // -----------------------------------------------------------------------
    api.registerTool(
      {
        name: 'edit',
        description: 'Replace text in a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to edit' },
            old_string: { type: 'string', description: 'Text to find' },
            new_string: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences (default false)' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const filePath = resolveSafePath(params.path as string);
          const oldString = params.old_string as string;
          const newString = params.new_string as string;
          const replaceAll = (params.replace_all as boolean) ?? false;

          let content = await fs.readFile(filePath, 'utf8');

          if (!replaceAll) {
            const firstIndex = content.indexOf(oldString);
            if (firstIndex === -1) {
              return json({ error: 'old_string not found in file', path: filePath });
            }
            const secondIndex = content.indexOf(oldString, firstIndex + 1);
            if (secondIndex !== -1) {
              return json({ error: 'old_string is not unique in file — use replace_all or provide more context', path: filePath });
            }
            content = content.replace(oldString, newString);
            await fs.writeFile(filePath, content, 'utf8');
            return json({ path: filePath, replacements: 1, edited: true });
          }

          const replacements = content.split(oldString).length - 1;
          content = content.split(oldString).join(newString);
          await fs.writeFile(filePath, content, 'utf8');
          return json({ path: filePath, replacements, edited: true });
        },
      },
      { group: 'fs' },
    );

    // -----------------------------------------------------------------------
    // apply_patch
    // -----------------------------------------------------------------------
    api.registerTool(
      {
        name: 'apply_patch',
        description: 'Apply a unified diff patch to a file',
        parameters: {
          type: 'object',
          properties: {
            patch: { type: 'string', description: 'Unified diff patch content' },
            path: { type: 'string', description: 'Target file path (if not in patch header)' },
          },
          required: ['patch'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const patchText = params.patch as string;
          let filePath = params.path as string | undefined;

          const patchLines = patchText.split('\n');

          // Extract file path from patch headers if not provided
          if (!filePath) {
            for (const line of patchLines) {
              if (line.startsWith('+++ ')) {
                let p = line.slice(4).trim();
                // Remove b/ prefix common in git diffs
                if (p.startsWith('b/')) p = p.slice(2);
                if (p && p !== '/dev/null') {
                  filePath = p;
                  break;
                }
              }
              if (line.startsWith('--- ')) {
                let p = line.slice(4).trim();
                if (p.startsWith('a/')) p = p.slice(2);
                if (p && p !== '/dev/null') {
                  filePath = p;
                  // Don't break — prefer +++ header
                }
              }
            }
          }

          if (!filePath) {
            return json({ error: 'Could not determine file path from patch or parameters' });
          }

          const resolvedPath = resolveSafePath(filePath);
          let fileContent: string;
          try {
            fileContent = await fs.readFile(resolvedPath, 'utf8');
          } catch {
            fileContent = '';
          }

          let fileLines = fileContent.split('\n');
          let hunksApplied = 0;
          let offset = 0; // Track line offset from previous hunks

          const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

          for (let i = 0; i < patchLines.length; i++) {
            const match = hunkHeaderRe.exec(patchLines[i]);
            if (!match) continue;

            const origStart = parseInt(match[1], 10);
            // Collect hunk lines
            const hunkOps: Array<{ op: string; text: string }> = [];

            let j = i + 1;
            while (j < patchLines.length) {
              const hl = patchLines[j];
              if (hl.startsWith('@@') || hl.startsWith('--- ') || hl.startsWith('+++ ') || hl.startsWith('diff ')) break;
              if (hl.startsWith('-')) {
                hunkOps.push({ op: '-', text: hl.slice(1) });
              } else if (hl.startsWith('+')) {
                hunkOps.push({ op: '+', text: hl.slice(1) });
              } else if (hl.startsWith(' ') || hl === '') {
                hunkOps.push({ op: ' ', text: hl.slice(1) });
              }
              j++;
            }

            // Apply hunk
            const applyAt = origStart - 1 + offset;
            let cursor = applyAt;
            const newFileLines = fileLines.slice(0, applyAt);
            let linesRemoved = 0;
            let linesAdded = 0;

            for (const op of hunkOps) {
              if (op.op === ' ') {
                // Context line — keep
                newFileLines.push(fileLines[cursor] ?? op.text);
                cursor++;
              } else if (op.op === '-') {
                // Remove line
                cursor++;
                linesRemoved++;
              } else if (op.op === '+') {
                // Add line
                newFileLines.push(op.text);
                linesAdded++;
              }
            }

            // Append remaining file lines
            newFileLines.push(...fileLines.slice(cursor));
            fileLines = newFileLines;
            offset += linesAdded - linesRemoved;
            hunksApplied++;
          }

          await fs.mkdir(nodePath.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, fileLines.join('\n'), 'utf8');
          return json({ path: resolvedPath, hunksApplied, patched: true });
        },
      },
      { group: 'fs' },
    );
  },
});

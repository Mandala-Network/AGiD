/**
 * Terminal display utilities
 */

// ANSI color codes (avoiding chalk dependency issues with ESM)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

export function color(text: string, ...codes: (keyof typeof colors)[]): string {
  const prefix = codes.map((c) => colors[c]).join('');
  return `${prefix}${text}${colors.reset}`;
}

export function bold(text: string): string {
  return color(text, 'bold');
}

export function dim(text: string): string {
  return color(text, 'dim');
}

export function success(text: string): string {
  return color(text, 'green');
}

export function error(text: string): string {
  return color(text, 'red');
}

export function warn(text: string): string {
  return color(text, 'yellow');
}

export function info(text: string): string {
  return color(text, 'cyan');
}

export function agent(text: string): string {
  return color(text, 'magenta');
}

/**
 * Format agent response for display
 */
export function formatAgentResponse(content: string): void {
  console.log();
  console.log(agent(bold('Agent:')));
  console.log(wrapText(content, 78));
  console.log();
}

/**
 * Format error for display
 */
export function formatError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.log();
  console.log(error(`Error: ${message}`));
  console.log();
}

/**
 * Format info message
 */
export function formatInfo(message: string): void {
  console.log(info(message));
}

/**
 * Format success message
 */
export function formatSuccess(message: string): void {
  console.log(success(message));
}

/**
 * Show a simple spinner
 */
export function showSpinner(text: string): { stop: () => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  process.stdout.write(`\r${dim(frames[i])} ${dim(text)}`);

  const interval = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${dim(frames[i])} ${dim(text)}`);
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
    },
  };
}

/**
 * Wrap text to specified width
 */
function wrapText(text: string, width: number): string {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= width) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines.join('\n');
}

/**
 * Clear current line
 */
export function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

/**
 * Print header
 */
export function printHeader(title: string): void {
  console.log();
  console.log(bold(title));
  console.log(dim('─'.repeat(title.length)));
}

/**
 * Print key-value pair
 */
export function printKeyValue(key: string, value: string): void {
  console.log(`${dim(key + ':')} ${value}`);
}

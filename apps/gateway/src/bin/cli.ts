import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../cli.js';

export interface CliProcessArgs {
  url: string;
  token?: string;
  commandArgs: string[];
}

export function parseCliArgs(argv: string[]): CliProcessArgs {
  let url = process.env.OPENOB_URL || 'http://127.0.0.1:4200';
  let token = process.env.OPENOB_TOKEN || undefined;
  const commandArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' && i + 1 < argv.length) {
      url = argv[++i];
    } else if (arg === '--token' && i + 1 < argv.length) {
      token = argv[++i];
    } else {
      commandArgs.push(arg);
    }
  }

  return { url, token, commandArgs };
}

export async function runCliProcess(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { url, token, commandArgs } = parseCliArgs(argv);

  const result = await runCli({
    url,
    token,
    args: commandArgs,
  });

  if (result.exitCode !== 0) {
    process.stderr.write(`${result.output}\n`);
    process.exit(result.exitCode);
  } else {
    process.stdout.write(`${result.output}\n`);
    process.exit(0);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  runCliProcess().catch((err) => {
    process.stderr.write(`Fatal error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });
}

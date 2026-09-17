import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {ensureServer, checkVersion} from './control.mjs';
import {relay} from './relay.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = path.dirname(sourceDirectory);
const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const valueOptions = new Set([
  '-c', '--config', '-m', '--model', '-p', '--profile', '-s', '--sandbox',
  '-a', '--ask-for-approval', '-C', '--cd', '-i', '--image', '--add-dir',
  '--enable', '--disable', '--remote', '--remote-auth-token-env',
]);
const commands = new Set([
  'agents', 'exec', 'e', 'review', 'login', 'logout', 'mcp', 'plugin',
  'app-server', 'remote-control', 'app', 'completion', 'update', 'doctor',
  'sandbox', 'debug', 'apply', 'resume', 'queue', 'archive', 'delete',
  'migrate-rollouts', 'unarchive', 'fork', 'cloud', 'exec-server', 'features', 'help',
]);

function command() {
  for (let index = 0; index < args.length; index++) {
    if (valueOptions.has(args[index])) {
      index++;
      continue;
    }
    if (args[index].startsWith('-')) continue;
    return commands.has(args[index]) ? args[index] : null;
  }
  return null;
}

function worktreeRoot() {
  const encoded = process.env.SUPACODE_WORKTREE_ID;
  if (!encoded) return process.cwd();
  try { return decodeURIComponent(encoded); }
  catch { return process.cwd(); }
}

const selectedCommand = command();
const direct = args.some(argument => (
  ['--help', '-h', '--version', '-V', '--remote'].includes(argument)
  || argument.startsWith('--remote=')
)) || (selectedCommand && !['agents', 'resume', 'fork'].includes(selectedCommand))
  || (process.env.CODEX_HOME && path.resolve(process.env.CODEX_HOME) !== config.codexHome);

async function main() {
  let bridge;
  let cliArgs = args;
  if (!direct) {
    await ensureServer();
    checkVersion();
    let endpoint = config.url;
    if (process.env.SUPACODE_SURFACE_ID && process.stdout.isTTY) {
      bridge = await relay({
        upstreamUrl: config.url,
        root: worktreeRoot(),
        emit: text => process.stdout.write(text),
      });
      endpoint = bridge.url;
    }
    const hasDirectory = args.some(argument => (
      argument === '-C' || argument === '--cd' || argument.startsWith('--cd=')
    ));
    const directoryArgs = !hasDirectory && (selectedCommand === null || selectedCommand === 'agents')
      ? ['--cd', process.cwd()]
      : [];
    cliArgs = ['--remote', endpoint, ...directoryArgs, ...args];
  }

  const child = spawn(config.codex, cliArgs, {stdio: 'inherit', env: process.env});
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.once('error', error => {
    bridge?.close();
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    bridge?.close();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});


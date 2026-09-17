import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {snapshot} from './connection.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = path.dirname(sourceDirectory);
const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
const service = `gui/${process.getuid()}/${config.label}`;
const launchctl = (...args) => spawnSync('/bin/launchctl', args, {encoding: 'utf8'});

async function health() {
  try {
    return (await fetch(config.url.replace('ws:', 'http:') + '/readyz', {
      signal: AbortSignal.timeout(1000),
    })).ok;
  } catch {
    return false;
  }
}

export async function ensureServer() {
  if (await health()) return;
  const loaded = launchctl('print', service).status === 0;
  const result = loaded
    ? launchctl('kickstart', service)
    : launchctl('bootstrap', `gui/${process.getuid()}`, config.plist);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Could not start the shared server');
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await health()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Shared server did not start. Examine ${path.join(directory, 'logs/server.err.log')}`);
}

export function checkVersion() {
  const stateFile = path.join(directory, 'server-state.json');
  const running = JSON.parse(fs.readFileSync(stateFile, 'utf8')).version;
  const installed = spawnSync(config.codex, ['--version'], {encoding: 'utf8'}).stdout.trim();
  if (running !== installed) {
    throw new Error('Codex changed. When tasks finish, run: codex-shared restart');
  }
  return installed;
}

async function requireIdle() {
  if (!(await health())) return;
  const state = await snapshot(config.url);
  if (state.active.length) {
    throw new Error(`${state.active.length} task(s) are active. Wait for them to finish before this operation.`);
  }
}

function restoreDesktopUrl(backup) {
  if (backup.desktopUrl) launchctl('setenv', 'CODEX_APP_SERVER_WS_URL', backup.desktopUrl);
  else launchctl('unsetenv', 'CODEX_APP_SERVER_WS_URL');
}

async function main() {
  const action = process.argv[2] ?? 'status';
  if (action === 'start') {
    await ensureServer();
    console.log('Shared Codex server is ready.');
    return;
  }
  if (action === 'status') {
    const ready = await health();
    console.log(`Shared server: ${ready ? 'ready' : 'stopped'}`);
    console.log(`Endpoint: ${config.url}`);
    console.log(`Desktop connection: ${launchctl('getenv', 'CODEX_APP_SERVER_WS_URL').stdout.trim() || 'not configured'}`);
    if (ready) {
      const state = await snapshot(config.url);
      console.log(`Tasks loaded: ${state.threads.length}; active: ${state.active.length}`);
      try { console.log(`Version: ${checkVersion()}`); }
      catch (error) { console.log(error.message); }
    }
    return;
  }
  if (action === 'doctor') {
    let failed = false;
    for (const [name, value] of [['Codex', config.codex], ['Node.js', config.node], ['LaunchAgent', config.plist]]) {
      const exists = fs.existsSync(value);
      console.log(`${name}: ${exists ? 'found' : 'missing'} (${value})`);
      failed ||= !exists;
    }
    const loopback = /^ws:\/\/127\.0\.0\.1:\d+$/.test(config.url);
    console.log(`Loopback endpoint: ${loopback ? 'yes' : 'no'} (${config.url})`);
    failed ||= !loopback;
    const ready = await health();
    console.log(`Server health: ${ready ? 'ready' : 'stopped'}`);
    failed ||= !ready;
    console.log(`Supacode: ${spawnSync('supacode', ['socket'], {encoding: 'utf8'}).status === 0 ? 'available' : 'not available'}`);
    if (failed) process.exitCode = 1;
    return;
  }
  if (action === 'restart') {
    await requireIdle();
    const result = launchctl('kickstart', '-k', service);
    if (result.status !== 0) throw new Error(result.stderr.trim());
    await new Promise(resolve => setTimeout(resolve, 1000));
    await ensureServer();
    console.log('Shared server restarted. Reattach terminal sessions with codex resume.');
    return;
  }
  if (action === 'undo') {
    await requireIdle();
    const backup = JSON.parse(fs.readFileSync(path.join(directory, 'install-backup.json'), 'utf8'));
    launchctl('bootout', service);
    restoreDesktopUrl(backup);
    if (fs.existsSync(config.plist)) fs.renameSync(config.plist, config.plist + '.disabled');
    for (const wrapper of backup.wrappers) {
      if (!fs.existsSync(wrapper.path)) continue;
      const stat = fs.lstatSync(wrapper.path);
      if (stat.isSymbolicLink() && fs.readlinkSync(wrapper.path) === wrapper.target) {
        fs.unlinkSync(wrapper.path);
      }
    }
    console.log('Shared setup disabled. Quit and reopen the desktop app. Saved conversations and setup files remain.');
    return;
  }
  throw new Error('Use: codex-shared status | doctor | start | restart | undo');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}


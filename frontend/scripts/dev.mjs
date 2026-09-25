#!/usr/bin/env bun
/**
 * Development run: the review engine, then the app.
 *
 * The engine is started here as its own process rather than embedded in
 * Electron. That is the point of this script: the backend can be restarted on
 * its own, hit with `curl` using the token it prints, and crash without taking
 * the UI with it. `electron:dev` remains available for when you only want the
 * app, and then Electron starts the engine itself.
 *
 * Nothing about the port or the secret is hardcoded. The engine binds an
 * ephemeral port and prints `CODE_RADAR_API_URL=` / `CODE_RADAR_API_TOKEN=`; this
 * script reads those lines and passes the values to Electron, so two dev
 * sessions can run side by side without fighting over a fixed port.
 *
 * The web dev server and the app are launched by the existing `electron:dev`
 * script, which already coordinates them with `concurrently` and `wait-on`.
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_ENTRY = path.join(FRONTEND_DIR, '..', 'engine', 'src', 'node', 'serve.ts');
const STARTUP_TIMEOUT_MS = 30_000;

const children = [];
let shuttingDown = false;

/** Prefixes a child's output so the engine and the app stay distinguishable. */
function pipeOutput(stream, label) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(`[${label}] ${line}\n`);
  });
}

/** Kills a child and everything it spawned. `child.kill()` alone misses those. */
function killTree(child) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  process.exit(code);
}

/** Starts the engine and resolves with the address and token it reports. */
function startEngine() {
  const child = spawn('bun', [ENGINE_ENTRY], {
    cwd: FRONTEND_DIR,
    // Port 0 keeps two dev sessions from colliding; the real port comes back on
    // stdout, which is why it is parsed rather than assumed.
    env: { ...process.env, CODE_RADAR_API_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      child.stdout.off('data', onData);
      reject(error);
    };

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const url = /CODE_RADAR_API_URL=(\S+)/.exec(buffer)?.[1];
      const token = /CODE_RADAR_API_TOKEN=(\S+)/.exec(buffer)?.[1];
      if (url !== undefined && token !== undefined) {
        child.stdout.off('data', onData);
        pipeOutput(child.stdout, 'api');
        resolve({ url, token });
      }
    };

    child.stdout.on('data', onData);
    pipeOutput(child.stderr, 'api');
    child.on('exit', (code) => fail(new Error(`the review engine exited with code ${code}`)));
    setTimeout(() => fail(new Error('the review engine did not report its address within 30s')), STARTUP_TIMEOUT_MS);
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error('interrupted');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the review engine did not answer at ${url}`);
}

async function main() {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));

  process.stdout.write('CodeRadar: starting the review engine as a separate process...\n');
  const engine = await startEngine();
  await waitForHealth(`${engine.url}/health/live`);
  process.stdout.write(
    `CodeRadar: engine ready at ${engine.url}\n` +
      `CodeRadar: token ${engine.token} (send it as the x-coderadar-token header)\n\n`,
  );

  process.stdout.write('CodeRadar: starting the web dev server and the app...\n');
  const app = spawn('bun', ['run', 'electron:dev'], {
    cwd: FRONTEND_DIR,
    env: {
      ...process.env,
      // What makes Electron connect to the engine above instead of starting its
      // own copy.
      CODE_RADAR_API_BASE_URL: engine.url,
      CODE_RADAR_API_TOKEN: engine.token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(app);
  pipeOutput(app.stdout, 'app');
  pipeOutput(app.stderr, 'app');

  // Closing the app ends the session; the engine follows it down.
  app.on('exit', (code) => shutdown(code ?? 0));
}

main().catch((error) => {
  process.stderr.write(`\nCodeRadar dev failed: ${error instanceof Error ? error.message : String(error)}\n`);
  shutdown(1);
});

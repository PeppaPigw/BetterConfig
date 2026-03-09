#!/usr/bin/env node
import { runApp } from './app/run-app.js';
import { createSystemCodexAdapter } from './codex/codex-adapter.js';
import { createClackDriver, AppCancelledError } from './ui/clack-driver.js';

export async function runCli(): Promise<void> {
  await runApp({
    driver: createClackDriver(),
    codexAdapter: createSystemCodexAdapter(),
  });
}

runCli().catch((error: unknown) => {
  if (error instanceof AppCancelledError) {
    process.stderr.write('Cancelled.\n');
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

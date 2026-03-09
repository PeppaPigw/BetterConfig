import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('official login flow', () => {
  it('proceeds past auth gate after successful official login', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-official-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, 'model = "before"\n', 'utf8');

    let authed = false;

    const driver = new TestPromptDriver([
      'en',
      'official',
      // after official login succeeds, auth gate exits → main menu
      'review-write',
      'write-config',
      true,
    ]);

    const result = await runApp({
      driver,
      configPath,
      stateDir,
      codexAdapter: {
        detect: async () => ({ installed: true, installHelp: [] }),
        checkAuth: async () => ({
          status: authed ? 'authenticated' : 'unauthenticated',
          details: authed ? 'ok' : 'login required',
        }),
        runOfficialLogin: async () => {
          authed = true;
          return { exitCode: 0, stdout: 'logged in', stderr: '' };
        },
      },
    });

    expect(result.status).toBe('written');
  });

  it('loops and retries when official login does not authenticate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-official-retry-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, '', 'utf8');

    const driver = new TestPromptDriver([
      'en',
      'official',   // first attempt — still unauthenticated
      'skip',       // choose skip to break out of loop
      'exit',       // exit main menu
    ]);

    const result = await runApp({
      driver,
      configPath,
      stateDir,
      codexAdapter: {
        detect: async () => ({ installed: true, installHelp: [] }),
        checkAuth: async () => ({ status: 'unauthenticated', details: 'not logged in' }),
        runOfficialLogin: async () => ({ exitCode: 1, stdout: '', stderr: 'cancelled' }),
      },
    });

    expect(result.status).toBe('exited');
  });
});

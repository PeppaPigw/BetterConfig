import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('runApp edit escape', () => {
  it('returns to the current menu when an enum editor is cancelled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-edit-escape-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, 'model = "before"\n', 'utf8');

    const driver = new TestPromptDriver([
      'en',
      'models-reasoning',
      'model_reasoning_effort',
      '__cancel__',
      'back',
      'exit',
    ]);

    const result = await runApp({
      driver,
      configPath,
      stateDir,
      codexAdapter: {
        detect: async () => ({ installed: true, installHelp: [] }),
        checkAuth: async () => ({ status: 'authenticated', details: 'ready' }),
        runOfficialLogin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
    });

    expect(result.status).toBe('exited');
    expect(driver.log.some((line) => line.includes('menu:🧠 Models & Reasoning'))).toBe(true);
  });
});

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('runApp two-level menu', () => {
  it('toggles a boolean field with space from the group list without opening a third level', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-two-level-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, 'model = "before"\n', 'utf8');

    const driver = new TestPromptDriver([
      'en',
      'common',
      'space:allow_login_shell',
      'back',
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
        checkAuth: async () => ({ status: 'authenticated', details: 'ready' }),
        runOfficialLogin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
    });

    const finalConfig = await readFile(configPath, 'utf8');

    expect(result.status).toBe('written');
    expect(finalConfig).toContain('allow_login_shell = false');
    expect(driver.log.some((line) => line.includes('menu:✨ Common'))).toBe(true);
    expect(driver.log.some((line) => line.includes('space:allow_login_shell'))).toBe(true);
  });
});

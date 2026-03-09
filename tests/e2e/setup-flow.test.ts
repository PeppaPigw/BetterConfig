import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('runApp setup flow', () => {
  it('captures the original config and writes a tested third-party config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-e2e-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, 'model = "before"\n', 'utf8');

    const driver = new TestPromptDriver([
      'zh-CN',
      'third-party',
      'https://demo.example.com/v1/chat/completions',
      'sk-demo',
      'gpt-5.4',
      'custom',
      'env',
      'OPENAI_API_KEY',
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
        checkAuth: async () => ({ status: 'unauthenticated', details: 'login required' }),
        runOfficialLogin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
      fetchImpl: async (_input, _init) => new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const finalConfig = await readFile(configPath, 'utf8');
    const originalSnapshot = await readFile(path.join(stateDir, 'snapshots', 'original.toml'), 'utf8');

    expect(result.status).toBe('written');
    expect(originalSnapshot).toBe('model = "before"\n');
    expect(finalConfig).toContain('model_provider = "custom"');
    expect(finalConfig).toContain('[model_providers.custom]');
    expect(finalConfig).toContain('base_url = "https://demo.example.com/v1"');
  });
});

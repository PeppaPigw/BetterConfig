import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('runApp rollback', () => {
  it('restores the previous config when post-write health checks fail', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-health-'));
    const configPath = path.join(root, 'config.toml');
    const stateDir = path.join(root, '.betterconfig');
    await writeFile(configPath, 'model = "before"\n', 'utf8');

    const result = await runApp({
      driver: new TestPromptDriver([
        'en',
        'third-party',
        'demo.example.com/v1',
        'sk-demo',
        'gpt-5.4',
        'custom',
        'env',
        'OPENAI_API_KEY',
        'review-write',
        'write-config',
        true,
      ]),
      configPath,
      stateDir,
      codexAdapter: {
        detect: async () => ({ installed: true, installHelp: [] }),
        checkAuth: async () => ({ status: 'unauthenticated', details: 'login required' }),
        runOfficialLogin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      healthCheck: async () => ({ ok: false, issues: [{ level: 'error', message: 'provider check failed' }] }),
    });

    const finalConfig = await readFile(configPath, 'utf8');
    expect(result.status).toBe('health-check-failed');
    expect(finalConfig).toBe('model = "before"\n');
  });
});

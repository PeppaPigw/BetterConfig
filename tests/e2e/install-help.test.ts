import { describe, expect, it } from 'vitest';
import { runApp } from '../../src/app/run-app.js';
import { TestPromptDriver } from '../helpers/test-driver.js';

describe('runApp install help', () => {
  it('shows install guidance when codex is missing', async () => {
    const driver = new TestPromptDriver(['en']);
    const result = await runApp({
      driver,
      codexAdapter: {
        detect: async () => ({ installed: false, installHelp: ['npm install -g @openai/codex'] }),
        checkAuth: async () => ({ status: 'unknown', details: '' }),
        runOfficialLogin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
    });

    expect(result.status).toBe('needs-install');
    expect(driver.log.some((line) => line.includes('@openai/codex'))).toBe(true);
  });
});

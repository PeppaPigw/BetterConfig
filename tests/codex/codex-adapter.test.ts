import { describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../../src/codex/codex-adapter.js';

describe('codex adapter', () => {
  it('reports install help when codex is missing', async () => {
    const adapter = createCodexAdapter({
      platform: 'linux',
      commandRunner: async () => ({ exitCode: 127, stdout: '', stderr: 'not found' }),
      which: async () => null,
    });

    const status = await adapter.detect();

    expect(status.installed).toBe(false);
    expect(status.installHelp.some((item) => item.includes('@openai/codex'))).toBe(true);
  });


  it('recognizes the real login status subcommand output', async () => {
    const calls: string[] = [];
    const adapter = createCodexAdapter({
      platform: 'darwin',
      which: async () => '/opt/homebrew/bin/codex',
      commandRunner: async (_command, args) => {
        calls.push(args.join(' '));
        if (args.join(' ') == 'login status') {
          return { exitCode: 0, stdout: 'Logged in using an API key - sk-***', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'unsupported' };
      },
    });

    const auth = await adapter.checkAuth();
    expect(calls[0]).toBe('login status');
    expect(auth.status).toBe('authenticated');
  });

  it('treats explicit auth-status success output as authenticated', async () => {
    const adapter = createCodexAdapter({
      platform: 'darwin',
      which: async () => '/usr/local/bin/codex',
      commandRunner: async (_command, args) => {
        if (args.join(' ') === 'auth status') {
          return { exitCode: 0, stdout: 'Authenticated as demo@example.com', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'unsupported' };
      },
    });

    const auth = await adapter.checkAuth();
    expect(auth.status).toBe('authenticated');
  });
});

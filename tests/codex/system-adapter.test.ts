import { describe, expect, it } from 'vitest';

import { createSystemCodexAdapter } from '../../src/codex/codex-adapter.js';

describe('createSystemCodexAdapter', () => {
  it('uses the real command probe flow instead of returning unknown by default', async () => {
    const adapter = createSystemCodexAdapter({
      whichImpl: async (name) => (name === 'codex' ? '/usr/local/bin/codex' : null),
      runImpl: async (_command, args) => {
        if (args.join(' ') === 'login status') {
          return { exitCode: 0, stdout: 'Logged in using an API key - sk-***', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'unsupported' };
      },
    });

    const detect = await adapter.detect();
    const auth = await adapter.checkAuth();

    expect(detect.installed).toBe(true);
    expect(auth.status).toBe('authenticated');
  });
});

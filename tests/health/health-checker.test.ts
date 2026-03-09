import { describe, expect, it } from 'vitest';
import { checkGeneratedConfig } from '../../src/health/health-checker.js';

describe('checkGeneratedConfig', () => {
  it('passes valid TOML and reports provider probe errors', async () => {
    const healthy = await checkGeneratedConfig({
      configText: 'model = "gpt-5.4"\n',
    });
    expect(healthy.ok).toBe(true);

    const unhealthy = await checkGeneratedConfig({
      configText: 'model = "gpt-5.4"\n',
      providerCheck: async () => ({ ok: false, error: { message: 'bad key' } }),
    });
    expect(unhealthy.ok).toBe(false);
    expect(unhealthy.issues[0]?.message).toContain('bad key');
  });
});

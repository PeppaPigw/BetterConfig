import { describe, expect, it } from 'vitest';
import { loadTemplate } from '../../src/config/template-loader.js';

describe('loadTemplate', () => {
  it('loads active values and commented entries from template.toml', async () => {
    const template = await loadTemplate();

    expect(template.activeValues.model).toBe('gpt-5.4');
    expect(template.entries.some((entry) => entry.path === 'model')).toBe(true);
    expect(template.entries.some((entry) => entry.path === 'log_dir' && entry.commented)).toBe(true);
    expect(template.entries.find((entry) => entry.path === 'approval_policy')?.descriptionZhCN).toContain('必要时');
    expect(template.entries.some((entry) => entry.path === 'model_providers.custom.base_url' && entry.commented)).toBe(true);
  });
});

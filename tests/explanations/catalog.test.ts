import { describe, expect, it } from 'vitest';
import { createExplanationCatalog } from '../../src/explanations/catalog.js';
import { loadTemplate } from '../../src/config/template-loader.js';

describe('createExplanationCatalog', () => {
  it('returns bilingual short explanations for known fields', async () => {
    const template = await loadTemplate();
    const catalog = await createExplanationCatalog(template);
    const model = catalog.get('model');
    const logDir = catalog.get('log_dir');

    expect(model?.zhCN.length).toBeGreaterThan(0);
    expect(model?.en.length).toBeGreaterThan(0);
    expect(model?.source).toBeTruthy();
    expect(logDir?.zhCN.length).toBeGreaterThan(0);
    expect(logDir?.en.length).toBeGreaterThan(0);
    expect(catalog.get('features.fast_mode')?.en).not.toContain('Controls the behavior of');
    expect(catalog.get('profiles.default.model')?.en).toContain('default profile');
  });
});

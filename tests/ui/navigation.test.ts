import { describe, expect, it } from 'vitest';
import { loadTemplate } from '../../src/config/template-loader.js';
import { createExplanationCatalog } from '../../src/explanations/catalog.js';
import { buildMenuMetadata } from '../../src/ui/menu-metadata.js';

describe('buildMenuMetadata', () => {
  it('puts Common first and flattens each group into direct editable items', async () => {
    const template = await loadTemplate();
    const explanations = await createExplanationCatalog(template);
    const groups = await buildMenuMetadata(template, explanations);

    expect(groups[0]?.id).toBe('common');
    expect(groups.find((group) => group.id === 'common')?.items.length).toBeGreaterThan(5);
    expect(groups.some((group) => group.id === 'snapshots')).toBe(true);
    expect(groups.some((group) => group.id === 'review-write')).toBe(true);
  });
});

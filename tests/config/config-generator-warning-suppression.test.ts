import TOML from '@iarna/toml';
import { describe, expect, it } from 'vitest';

import { loadTemplate } from '../../src/config/template-loader.js';
import { generateConfigToml } from '../../src/config/config-generator.js';
import { createConfigSession } from '../../src/config/session.js';

describe('unstable feature warning suppression', () => {
  it('auto-enables suppress_unstable_features_warning when unstable features are enabled by defaults', async () => {
    const template = await loadTemplate();
    const session = createConfigSession(template);

    const parsed = TOML.parse(generateConfigToml(template, session)) as Record<string, any>;

    expect(parsed.suppress_unstable_features_warning).toBe(true);
  });

  it('respects an explicit user choice to keep unstable warnings visible', async () => {
    const template = await loadTemplate();
    const session = createConfigSession(template);
    session.set('suppress_unstable_features_warning', false);

    const parsed = TOML.parse(generateConfigToml(template, session)) as Record<string, any>;

    expect(parsed.suppress_unstable_features_warning).toBe(false);
  });
});

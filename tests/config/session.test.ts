import { describe, expect, it } from 'vitest';

import { loadTemplate } from '../../src/config/template-loader.js';
import { createConfigSession } from '../../src/config/session.js';
import { generateConfigToml } from '../../src/config/config-generator.js';
import TOML from '@iarna/toml';

describe('ConfigSession profile mirroring', () => {
  it('mirrors top-level provider changes into the active profile when that profile still uses defaults', async () => {
    const template = await loadTemplate();
    const session = createConfigSession(template);

    session.set('model_provider', 'custom');
    session.set('model', 'gpt-5.4');

    const rendered = generateConfigToml(template, session);
    const parsed = TOML.parse(rendered) as Record<string, any>;

    expect(parsed.model_provider).toBe('custom');
    expect(parsed.profiles.default.model_provider).toBe('custom');
    expect(parsed.profiles.default.model).toBe('gpt-5.4');
  });
});

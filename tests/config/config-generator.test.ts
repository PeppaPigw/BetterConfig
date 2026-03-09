import { describe, expect, it } from 'vitest';
import { loadTemplate } from '../../src/config/template-loader.js';
import { createConfigSession } from '../../src/config/session.js';
import { generateConfigToml } from '../../src/config/config-generator.js';

describe('generateConfigToml', () => {
  it('emits a full config with stable ordering and omitted commented defaults', async () => {
    const template = await loadTemplate();
    const session = createConfigSession(template);
    const toml = generateConfigToml(template, session);

    expect(toml).toContain('#:schema https://developers.openai.com/codex/config-schema.json');
    expect(toml).toContain('model = "gpt-5.4"');
    expect(toml).toContain('[features]');
    expect(toml).not.toContain('[model_providers.custom]');
  });

  it('omits deprecated compatibility keys that Codex warns about at runtime', async () => {
    const template = await loadTemplate();
    const session = createConfigSession(template);
    const toml = generateConfigToml(template, session);

    expect(toml).not.toContain('experimental_use_unified_exec_tool = true');
    expect(toml).not.toContain('[tools]\nweb_search = true');
    expect(toml).not.toContain('tools_web_search = true');
    expect(toml).not.toContain('web_search_cached = true');
    expect(toml).not.toContain('web_search_request = false');
  });
});

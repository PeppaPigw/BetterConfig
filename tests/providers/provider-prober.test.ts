import { describe, expect, it } from 'vitest';
import { probeOpenAICompatibleProvider } from '../../src/providers/provider-prober.js';

describe('probeOpenAICompatibleProvider', () => {
  it('returns models after a successful probe', async () => {
    const result = await probeOpenAICompatibleProvider({
      inputUrl: 'https://demo.example.com/v1',
      apiKey: 'sk-demo',
      fetchImpl: async (_input, init) => {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-demo' });
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-4.1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toEqual(['gpt-4.1', 'gpt-5.4']);
      expect(result.baseUrl).toBe('https://demo.example.com/v1');
    }
  });

  it('categorizes auth failures', async () => {
    const result = await probeOpenAICompatibleProvider({
      inputUrl: 'https://demo.example.com',
      apiKey: 'bad-key',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'bad key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('auth');
    }
  });
});

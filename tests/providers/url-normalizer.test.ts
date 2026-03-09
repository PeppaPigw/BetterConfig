import { describe, expect, it } from 'vitest';
import { buildCandidateBaseUrls } from '../../src/providers/url-normalizer.js';

describe('buildCandidateBaseUrls', () => {
  it('normalizes chat completion endpoints into base URL candidates', () => {
    expect(buildCandidateBaseUrls('https://demo.example.com/v1/chat/completions')).toEqual([
      'https://demo.example.com/v1',
      'https://demo.example.com'
    ]);
  });

  it('keeps localhost on http and removes duplicate v1 markers', () => {
    expect(buildCandidateBaseUrls('localhost:8000/v1/v1')).toContain('http://localhost:8000/v1');
  });
});

import { describe, expect, it } from 'vitest';
import { renderBanner } from '../../src/ui/banner.js';

describe('renderBanner', () => {
  it('contains the product name', () => {
    expect(renderBanner().toUpperCase()).toContain('BETTERCONFIG');
  });
});

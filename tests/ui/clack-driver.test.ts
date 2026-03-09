import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';

import { runInteractiveMenu } from '../../src/ui/clack-driver.js';
import type { MenuOption } from '../../src/ui/driver.js';

class MockTTYInput extends EventEmitter {
  public isTTY = true;
  public isRaw = false;
  public resumeCalls = 0;
  public pauseCalls = 0;
  public rawModes: boolean[] = [];

  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModes.push(value);
    return this;
  }

  resume(): this {
    this.resumeCalls += 1;
    return this;
  }

  pause(): this {
    this.pauseCalls += 1;
    return this;
  }
}

class MockTTYOutput {
  public isTTY = true;
  public columns: number;
  public buffer = '';

  constructor(columns = 140) {
    this.columns = columns;
  }

  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
}

describe('runInteractiveMenu', () => {
  it('keeps stdin alive until a keypress arrives, then restores stdin state', async () => {
    const stdin = new MockTTYInput();
    const stdout = new MockTTYOutput();
    const viewport = { height: 0 };
    const options: MenuOption[] = [
      { value: 'alpha', label: 'Alpha' },
      { value: 'beta', label: 'Beta' },
    ];

    const pending = runInteractiveMenu({ message: 'Pick one' }, options, stdin as never, stdout as never, viewport);
    expect(stdin.resumeCalls).toBe(1);
    setImmediate(() => stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' }));
    const result = await pending;

    expect(result).toEqual({ action: 'enter', value: 'alpha', cursor: 0 });
    expect(stdin.pauseCalls).toBe(1);
    expect(stdin.rawModes).toContain(true);
    expect(stdin.rawModes.at(-1)).toBe(false);
  });

  it('clears the previous menu viewport before drawing the next menu', async () => {
    const stdin = new MockTTYInput();
    const stdout = new MockTTYOutput();
    const viewport = { height: 0 };
    const options: MenuOption[] = [
      { value: 'alpha', label: 'Alpha' },
      { value: 'beta', label: 'Beta' },
    ];

    const first = runInteractiveMenu({ message: 'Top level' }, options, stdin as never, stdout as never, viewport);
    setImmediate(() => stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' }));
    await first;

    const beforeSecond = stdout.buffer.length;
    const second = runInteractiveMenu({ message: 'Second menu' }, options, stdin as never, stdout as never, viewport);
    setImmediate(() => stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' }));
    await second;

    const secondChunk = stdout.buffer.slice(beforeSecond);
    expect(secondChunk).toMatch(/\u001b\[[0-9]+A/);
  });

  it('renders a wide menu as three left-aligned columns and places the hint on the selected row without a divider', async () => {
    const stdin = new MockTTYInput();
    const stdout = new MockTTYOutput(140);
    const viewport = { height: 0 };
    const options: MenuOption[] = [
      { value: 'alpha', icon: '🧠', label: 'Models & Reasoning', hint: 'Current: gpt-5.4' },
      { value: 'beta', icon: '🔐', label: 'Auth & Providers', hint: 'Manage official and third-party access.' },
    ];

    const pending = runInteractiveMenu({ message: 'Wide menu' }, options, stdin as never, stdout as never, viewport);
    setImmediate(() => stdin.emit('keypress', '\u001b[B', { name: 'down', ctrl: false, meta: false, shift: false, sequence: '\u001b[B' }));
    setImmediate(() => stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' }));
    await pending;

    const rendered = stripAnsi(stdout.buffer);
    expect(rendered).toContain('Auth & Providers');
    expect(rendered).toContain('Manage official and third-party access.');
    expect(rendered).not.toContain('│');
  });

  it('falls back to a bottom description area on narrow terminals', async () => {
    const stdin = new MockTTYInput();
    const stdout = new MockTTYOutput(40);
    const viewport = { height: 0 };
    const options: MenuOption[] = [
      { value: 'alpha', label: 'Model', hint: 'This hint should render below the list.' },
      { value: 'beta', label: 'Provider', hint: 'Other hint' },
    ];

    const pending = runInteractiveMenu({ message: 'Narrow menu' }, options, stdin as never, stdout as never, viewport);
    setImmediate(() => stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' }));
    await pending;

    const rendered = stripAnsi(stdout.buffer);
    expect(rendered).toContain('This hint should render below the list.');
    expect(rendered).toContain('─');
  });
});

import { confirm, intro, isCancel, note, outro, password, select, text } from '@clack/prompts';
import pc from 'picocolors';
import readline from 'node:readline';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';

import type { MenuOption, MenuResult, PromptDriver, PromptMessage, SelectOption } from './driver.js';

export class AppCancelledError extends Error {
  constructor() {
    super('Cancelled by user.');
  }
}

interface MenuViewportState {
  height: number;
}

const MIN_RIGHT_PANE_HINT_WIDTH = 18;
const MARKER_COL = 1;
const ICON_COL = 4;
const LABEL_COL = 8;
const MIN_HINT_COL = 38;
const BOTTOM_HINT_LINES = 2;

export function createClackDriver(): PromptDriver {
  const viewport: MenuViewportState = { height: 0 };
  // Remember the last cursor position per menu message key so we can restore it.
  const cursorMemory = new Map<string, number>();

  return {
    intro(message) {
      clearMenuViewport(process.stdout, viewport);
      intro(message);
    },
    outro(message) {
      clearMenuViewport(process.stdout, viewport);
      outro(message);
    },
    note(message, title) {
      clearMenuViewport(process.stdout, viewport);
      note(message, title);
    },
    async select(message: PromptMessage, options: SelectOption[]) {
      clearMenuViewport(process.stdout, viewport);
      const result = await select({
        message: message.message,
        options: options.map((option) => ({ value: option.value, label: option.label, hint: option.hint })),
      });
      if (isCancel(result)) {
        throw new AppCancelledError();
      }
      return String(result);
    },
    async menu(message: PromptMessage, options: MenuOption[]): Promise<MenuResult> {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        clearMenuViewport(process.stdout, viewport);
        const value = await this.select(message, options.map((option) => ({ value: option.value, label: option.label, hint: option.hint })));
        return { action: 'enter', value };
      }

      const key = message.message;
      const initialCursor = cursorMemory.get(key) ?? 0;
      const result = await runInteractiveMenu(message, options, process.stdin, process.stdout, viewport, initialCursor);
      if (result.cursor !== undefined) {
        cursorMemory.set(key, result.cursor);
      }
      return result;
    },
    async confirm(message: PromptMessage) {
      clearMenuViewport(process.stdout, viewport);
      const result = await confirm({ message: message.message });
      if (isCancel(result)) {
        throw new AppCancelledError();
      }
      return Boolean(result);
    },
    async text(message: PromptMessage) {
      clearMenuViewport(process.stdout, viewport);
      const result = await text({
        message: message.message,
        placeholder: message.placeholder,
        defaultValue: message.initialValue,
      });
      if (isCancel(result)) {
        throw new AppCancelledError();
      }
      return String(result);
    },
    async password(message: PromptMessage) {
      clearMenuViewport(process.stdout, viewport);
      const result = await password({ message: message.message });
      if (isCancel(result)) {
        throw new AppCancelledError();
      }
      return String(result);
    },
  };
}

export function runInteractiveMenu(
  message: PromptMessage,
  options: MenuOption[],
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  viewport: MenuViewportState,
  initialCursor = 0,
): Promise<MenuResult> {
  return new Promise<MenuResult>((resolve, reject) => {
    const previousRawMode = stdin.isRaw;
    let cursor = Math.min(initialCursor, options.length - 1);
    if (cursor < 0) cursor = 0;

    const render = () => {
      clearMenuViewport(stdout, viewport);
      const columns = stdout.columns ?? 80;
      const frame = buildMenuFrame(message.message, options, cursor, columns);
      stdout.write(frame.output);
      viewport.height = frame.height;
    };

    const cleanup = () => {
      stdin.off('keypress', onKeypress);
      if (stdin.isTTY) {
        stdin.setRawMode(Boolean(previousRawMode));
        stdin.pause();
      }
    };

    const onKeypress = (_char: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') {
        clearMenuViewport(stdout, viewport);
        cleanup();
        reject(new AppCancelledError());
        return;
      }
      if (key.name === 'up') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === 'down') {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
      if (key.name === 'escape' || key.name === 'left') {
        clearMenuViewport(stdout, viewport);
        cleanup();
        resolve({ action: 'back', cursor });
        return;
      }
      const current = options[cursor];
      if (key.name === 'return' || key.name === 'enter') {
        clearMenuViewport(stdout, viewport);
        cleanup();
        resolve({ action: 'enter', value: current?.value, cursor });
        return;
      }
      if (key.name === 'space' && current?.kind === 'toggle') {
        clearMenuViewport(stdout, viewport);
        cleanup();
        resolve({ action: 'space', value: current.value, cursor });
      }
    };

    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdin.resume();
      stdin.setRawMode(true);
    }
    stdin.on('keypress', onKeypress);
    render();
  });
}

function clearMenuViewport(stdout: NodeJS.WriteStream, viewport: MenuViewportState): void {
  if (viewport.height > 0) {
    readline.moveCursor(stdout, 0, -viewport.height);
  }
  readline.cursorTo(stdout, 0, undefined);
  readline.clearScreenDown(stdout);
  viewport.height = 0;
}

function buildMenuFrame(message: string, options: MenuOption[], cursor: number, columns: number) {
  const headerLines = [
    pc.bold(message),
    pc.dim('↑↓ navigate  Enter open/edit  Space toggle  Esc/← back'),
    '',
  ];

  if (canRenderRightPane(options, columns)) {
    const body = buildWideBody(options, cursor, columns);
    return {
      output: [...headerLines, ...body].join('\n') + '\n',
      height: headerLines.length + body.length,
    };
  }

  const body = buildNarrowBody(options, cursor, columns);
  return {
    output: [...headerLines, ...body].join('\n') + '\n',
    height: headerLines.length + body.length,
  };
}


function canRenderRightPane(options: MenuOption[], columns: number): boolean {
  const labelWidth = Math.max(...options.map((option) => stringWidth(option.label)), 0);
  const hintCol = Math.max(MIN_HINT_COL, LABEL_COL + labelWidth + 2);
  return columns - hintCol + 1 >= MIN_RIGHT_PANE_HINT_WIDTH;
}

function buildWideBody(options: MenuOption[], cursor: number, columns: number): string[] {
  // Compute the natural label width, but cap it so the hint pane always gets
  // at least MIN_RIGHT_PANE_HINT_WIDTH columns.  This prevents very long labels
  // from pushing the hint column past the right edge.
  const naturalLabelWidth = Math.max(...options.map((option) => stringWidth(option.label)), 0);
  const maxLabelWidth = Math.max(0, columns - LABEL_COL - MIN_RIGHT_PANE_HINT_WIDTH - 2);
  const labelWidth = Math.min(naturalLabelWidth, maxLabelWidth);
  const hintCol = Math.max(MIN_HINT_COL, LABEL_COL + labelWidth + 2);
  const hintWidth = Math.max(16, columns - hintCol);
  const selectedHint = truncateToWidth(options[cursor]?.hint ?? '', hintWidth);

  return options.map((option, index) => {
    const row = formatAlignedRow(option, index === cursor, index === cursor ? pc.dim(selectedHint) : '', hintCol, labelWidth);
    return row;
  });
}

function buildNarrowBody(options: MenuOption[], cursor: number, columns: number): string[] {
  const rows = options.map((option, index) => formatSimpleRow(option, index === cursor));
  const hintWidth = Math.max(20, Math.min(columns, 60));
  const hintLines = wrapText(options[cursor]?.hint ?? '', hintWidth).slice(0, BOTTOM_HINT_LINES);
  rows.push(pc.dim('─'.repeat(hintWidth)));
  for (let index = 0; index < BOTTOM_HINT_LINES; index += 1) {
    rows.push(hintLines[index] ? pc.dim(hintLines[index]!) : '');
  }
  return rows;
}

function formatAlignedRow(option: MenuOption, selected: boolean, hint: string, hintCol: number, maxLabelWidth: number): string {
  const marker = selected ? pc.cyan('❯') : ' ';
  const toggle = option.kind === 'toggle'
    ? option.checked
      ? pc.green('[on] ')
      : pc.dim('[off] ')
    : '';
  // Truncate the label to maxLabelWidth so it never bleeds into the hint column.
  const toggleWidth = stringWidth(toggle);
  const availableForLabel = Math.max(0, maxLabelWidth - toggleWidth);
  const label = truncateToWidth(option.label, availableForLabel);
  const labelPart = toggle + label;
  const pieces = [
    `${cursorToColumn(MARKER_COL)}${marker}`,
    option.icon ? `${cursorToColumn(ICON_COL)}${option.icon}` : '',
    `${cursorToColumn(LABEL_COL)}${labelPart}`,
    hint ? `${cursorToColumn(hintCol)}${hint}` : '',
  ];
  return pieces.join('');
}

function formatSimpleRow(option: MenuOption, selected: boolean): string {
  const marker = selected ? pc.cyan('❯') : ' ';
  const toggle = option.kind === 'toggle'
    ? option.checked
      ? pc.green('[on] ')
      : pc.dim('[off] ')
    : '';
  const icon = option.icon ? `${option.icon}  ` : '';
  return `${marker}  ${icon}${toggle}${option.label}`;
}

function cursorToColumn(column: number): string {
  return `\u001b[${column}G`;
}

function truncateToWidth(input: string, width: number): string {
  if (!input) {
    return '';
  }
  let current = '';
  for (const char of input) {
    const next = current + char;
    if (stringWidth(next) > width) {
      return current ? `${current}…` : '…';
    }
    current = next;
  }
  return current;
}

function wrapText(input: string, width: number): string[] {
  if (!input) {
    return [];
  }

  const words = input.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (stringWidth(next) > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}


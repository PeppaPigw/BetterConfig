import { readFile } from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';

import type { JsonObject, JsonValue, LoadedTemplate, TemplateEntry } from '../types.js';

const ASSIGNMENT_PATTERN = /^\s*(#\s*)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$/;
const SECTION_PATTERN = /^\s*(?:#\s*)?\[(?<name>[^\]]+)\]\s*$/;
const COMMENT_PATTERN = /^\s*#(.*)$/;

export async function loadTemplate(sourcePath = path.resolve('template.toml')): Promise<LoadedTemplate> {
  const source = await readFile(sourcePath, 'utf8');
  const activeValues = TOML.parse(source) as JsonObject;
  const entries = parseTemplateEntries(source);
  return { sourcePath, activeValues, entries };
}

function parseTemplateEntries(source: string): TemplateEntry[] {
  const lines = source.split(/\r?\n/);
  const entries: TemplateEntry[] = [];
  const sectionPath: string[] = [];
  let commentBuffer: string[] = [];
  let order = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed) {
      commentBuffer = [];
      continue;
    }

    const sectionMatch = trimmed.match(SECTION_PATTERN);
    if (sectionMatch?.groups?.name) {
      sectionPath.length = 0;
      sectionPath.push(...sectionMatch.groups.name.split('.'));
      commentBuffer = [];
      continue;
    }

    const commentMatch = rawLine.match(COMMENT_PATTERN);
    if (commentMatch && !rawLine.match(ASSIGNMENT_PATTERN)) {
      const commentText = commentMatch[1]?.trim();
      if (commentText && !commentText.startsWith(':schema')) {
        commentBuffer.push(commentText.replace(/^[-*]\s*/, ''));
      }
      continue;
    }

    const assignmentMatch = rawLine.match(ASSIGNMENT_PATTERN);
    if (!assignmentMatch?.groups?.key) {
      commentBuffer = [];
      continue;
    }

    const commented = Boolean(assignmentMatch[1]);
    const key = assignmentMatch.groups.key;
    let valuePart = stripTrailingInlineComment(assignmentMatch.groups.value ?? '').trim();
    const collectedLines = [valuePart];
    let cursor = index;

    while (isMultilineValueOpen(collectedLines.join('\n')) && cursor + 1 < lines.length) {
      cursor += 1;
      const nextLine = lines[cursor] ?? '';
      collectedLines.push(stripCommentPrefix(nextLine));
    }

    index = cursor;
    const rawValue = collectedLines.join('\n').trim();
    const descriptionZhCN = extractInlineComment(rawLine) ?? combineCommentBuffer(commentBuffer);
    commentBuffer = [];

    entries.push({
      path: [...sectionPath, key].join('.'),
      key,
      scopePath: [...sectionPath],
      rawValue,
      value: parseValue(sectionPath, key, rawValue),
      order: order += 1,
      commented,
      descriptionZhCN,
    });
  }

  return dedupeEntries(entries);
}

function dedupeEntries(entries: TemplateEntry[]): TemplateEntry[] {
  const seen = new Map<string, TemplateEntry>();
  for (const entry of entries) {
    seen.set(entry.path, entry);
  }
  return [...seen.values()].sort((left, right) => left.order - right.order);
}

function parseValue(sectionPath: string[], key: string, rawValue: string): JsonValue | undefined {
  if (!rawValue) {
    return undefined;
  }

  const document = [
    ...(sectionPath.length > 0 ? [`[${sectionPath.join('.')}]`] : []),
    `${key} = ${rawValue}`,
  ].join('\n');

  try {
    const parsed = TOML.parse(document) as JsonObject;
    let current: JsonValue = parsed;
    for (const segment of [...sectionPath, key]) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as JsonObject)[segment] as JsonValue;
    }
    return current;
  } catch {
    return undefined;
  }
}

function stripTrailingInlineComment(value: string): string {
  let inString = false;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if ((char === '"' || char === "'") && previous !== '\\') {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
        quote = '';
      }
    }
    if (char === '#' && !inString) {
      return value.slice(0, index);
    }
  }
  return value;
}

function extractInlineComment(rawLine: string): string | undefined {
  let inString = false;
  let quote = '';
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    const previous = rawLine[index - 1];
    if ((char === '"' || char === "'") && previous !== '\\') {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
        quote = '';
      }
    }
    if (char === '#' && !inString) {
      const comment = rawLine.slice(index + 1).trim();
      return comment || undefined;
    }
  }
  return undefined;
}

function stripCommentPrefix(line: string): string {
  return line.replace(/^\s*#\s?/, '');
}

function combineCommentBuffer(buffer: string[]): string | undefined {
  if (buffer.length === 0) {
    return undefined;
  }
  return buffer.join(' ').trim() || undefined;
}

function isMultilineValueOpen(rawValue: string): boolean {
  const sanitized = rawValue.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  const squareBalance = (sanitized.match(/\[/g) ?? []).length - (sanitized.match(/\]/g) ?? []).length;
  const curlyBalance = (sanitized.match(/\{/g) ?? []).length - (sanitized.match(/\}/g) ?? []).length;
  return squareBalance > 0 || curlyBalance > 0;
}

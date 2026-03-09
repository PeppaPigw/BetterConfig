import type { JsonObject, JsonValue } from '../types.js';

export function getAtPath(root: JsonObject, path: string[]): JsonValue | undefined {
  let current: JsonValue = root;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment] as JsonValue;
  }
  return current;
}

export function setAtPath(root: JsonObject, path: string[], value: JsonValue): JsonObject {
  let current: JsonObject = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as JsonObject;
  }
  current[path[path.length - 1]] = value;
  return root;
}

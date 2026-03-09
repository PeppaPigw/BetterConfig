import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SchemaFieldMetadata } from '../types.js';

interface JsonSchemaNode {
  $ref?: string;
  allOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  description?: string;
  type?: string | string[];
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchemaNode;
}

interface JsonSchemaRoot extends JsonSchemaNode {
  definitions?: Record<string, JsonSchemaNode>;
}

let schemaCache: JsonSchemaRoot | undefined;
const metadataCache = new Map<string, SchemaFieldMetadata>();

export async function getSchemaFieldMetadata(pathKey: string): Promise<SchemaFieldMetadata | undefined> {
  if (metadataCache.has(pathKey)) {
    return metadataCache.get(pathKey);
  }

  const schema = await loadSchema();
  const resolved = resolvePath(schema, pathKey.split('.'));
  if (!resolved) {
    metadataCache.set(pathKey, undefined as unknown as SchemaFieldMetadata);
    return undefined;
  }

  const metadata: SchemaFieldMetadata = {
    path: pathKey,
    description: resolved.description,
    type: normalizeType(resolved),
    enumValues: (resolved.enum ?? []).map(String),
  };
  metadataCache.set(pathKey, metadata);
  return metadata;
}

async function loadSchema(): Promise<JsonSchemaRoot> {
  if (schemaCache) {
    return schemaCache;
  }
  const sourcePath = path.resolve('data/official/codex-config-schema.json');
  const source = await readFile(sourcePath, 'utf8');
  schemaCache = JSON.parse(source) as JsonSchemaRoot;
  return schemaCache;
}

function resolvePath(root: JsonSchemaRoot, segments: string[]): JsonSchemaNode | undefined {
  let current: JsonSchemaNode | undefined = root;
  for (const segment of segments) {
    if (!current) {
      return undefined;
    }
    const expanded = expandNode(root, current);
    if (expanded.properties?.[segment]) {
      current = expanded.properties[segment];
      continue;
    }
    if (expanded.additionalProperties && typeof expanded.additionalProperties === 'object') {
      current = expanded.additionalProperties;
      continue;
    }
    return undefined;
  }
  return current ? expandNode(root, current) : undefined;
}

function expandNode(root: JsonSchemaRoot, node: JsonSchemaNode): JsonSchemaNode {
  const parts: JsonSchemaNode[] = [];
  if (node.$ref) {
    parts.push(resolveRef(root, node.$ref));
  }
  if (node.allOf) {
    parts.push(...node.allOf.map((item) => expandNode(root, item)));
  }
  if (node.anyOf?.length) {
    parts.push(expandNode(root, node.anyOf[0]!));
  }
  if (node.oneOf?.length) {
    parts.push(expandNode(root, node.oneOf[0]!));
  }
  parts.push(stripCombinators(node));
  return mergeNodes(parts);
}

function resolveRef(root: JsonSchemaRoot, ref: string): JsonSchemaNode {
  const match = ref.match(/^#\/definitions\/(.+)$/);
  if (!match) {
    return {};
  }
  return expandNode(root, root.definitions?.[match[1]] ?? {});
}

function stripCombinators(node: JsonSchemaNode): JsonSchemaNode {
  const { $ref: _ref, allOf: _allOf, anyOf: _anyOf, oneOf: _oneOf, ...rest } = node;
  return rest;
}

function mergeNodes(nodes: JsonSchemaNode[]): JsonSchemaNode {
  return nodes.reduce<JsonSchemaNode>((merged, node) => {
    const properties = { ...(merged.properties ?? {}), ...(node.properties ?? {}) };
    return {
      ...merged,
      ...node,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      additionalProperties: node.additionalProperties ?? merged.additionalProperties,
      description: node.description ?? merged.description,
      type: node.type ?? merged.type,
      enum: node.enum ?? merged.enum,
      items: node.items ?? merged.items,
    };
  }, {});
}

function normalizeType(node: JsonSchemaNode): string {
  if (Array.isArray(node.type)) {
    return node.type.join('|');
  }
  if (node.type) {
    return node.type;
  }
  if (node.properties || node.additionalProperties) {
    return 'object';
  }
  if (node.items) {
    return 'array';
  }
  if (node.enum) {
    return 'string';
  }
  return 'unknown';
}

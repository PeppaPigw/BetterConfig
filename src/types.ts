export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface TemplateEntry {
  path: string;
  key: string;
  scopePath: string[];
  rawValue: string;
  value: JsonValue | undefined;
  order: number;
  commented: boolean;
  descriptionZhCN?: string;
}

export interface LoadedTemplate {
  sourcePath: string;
  activeValues: JsonObject;
  entries: TemplateEntry[];
}

export interface SchemaFieldMetadata {
  path: string;
  description?: string;
  type: string;
  enumValues: string[];
}

export interface ExplanationRecord {
  path: string;
  zhCN: string;
  en: string;
  source: 'override' | 'template-comment' | 'schema' | 'fallback';
}

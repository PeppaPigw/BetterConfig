import type { JsonValue, LoadedTemplate, TemplateEntry } from '../types.js';

export class ConfigSession {
  private readonly values = new Map<string, JsonValue | undefined>();
  private readonly defaults = new Map<string, JsonValue | undefined>();
  private readonly touched = new Set<string>();

  constructor(private readonly template: LoadedTemplate) {
    for (const entry of template.entries) {
      const defaultValue = getTemplateDefault(entry);
      this.defaults.set(entry.path, defaultValue);
      this.values.set(entry.path, defaultValue);
    }
  }

  get(path: string): JsonValue | undefined {
    return this.values.get(path);
  }

  set(path: string, value: JsonValue | undefined): void {
    this.writeValue(path, value, true);
  }

  reset(path: string): void {
    this.writeValue(path, this.defaults.get(path), true);
  }

  clear(path: string): void {
    this.writeValue(path, undefined, true);
  }

  applyDefaults(paths: string[]): void {
    for (const path of paths) {
      this.reset(path);
    }
  }

  entries(): Array<[string, JsonValue | undefined]> {
    return this.template.entries.map((entry) => [entry.path, this.values.get(entry.path)]);
  }

  isTouched(path: string): boolean {
    return this.touched.has(path);
  }

  private writeValue(path: string, value: JsonValue | undefined, markTouched: boolean): void {
    this.values.set(path, value);
    if (markTouched) {
      this.touched.add(path);
    }
    this.mirrorTopLevelField(path, value);
  }

  private mirrorTopLevelField(path: string, value: JsonValue | undefined): void {
    if (path.includes('.')) {
      return;
    }

    const activeProfile = this.get('profile');
    if (typeof activeProfile !== 'string' || !activeProfile) {
      return;
    }

    const profilePath = `profiles.${activeProfile}.${path}`;
    if (!this.defaults.has(profilePath)) {
      return;
    }

    if (isEqual(this.values.get(profilePath), this.defaults.get(profilePath))) {
      this.writeValue(profilePath, value, false);
    }
  }
}

export function createConfigSession(template: LoadedTemplate): ConfigSession {
  return new ConfigSession(template);
}

export function getTemplateDefault(entry: TemplateEntry): JsonValue | undefined {
  return entry.commented ? undefined : entry.value;
}

function isEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

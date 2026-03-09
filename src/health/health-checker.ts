import TOML from '@iarna/toml';

export interface HealthIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface HealthResult {
  ok: boolean;
  issues: HealthIssue[];
}

export async function checkGeneratedConfig(options: {
  configText: string;
  providerCheck?: () => Promise<{ ok: boolean; error?: { message: string } }>;
}): Promise<HealthResult> {
  const issues: HealthIssue[] = [];

  try {
    TOML.parse(options.configText);
  } catch (error) {
    issues.push({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (options.providerCheck) {
    const provider = await options.providerCheck();
    if (!provider.ok) {
      issues.push({
        level: 'error',
        message: provider.error?.message ?? 'Provider health check failed.',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

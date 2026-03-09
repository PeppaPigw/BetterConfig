import { execa } from 'execa';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CodexAdapterOptions {
  platform?: NodeJS.Platform;
  which?: (name: string) => Promise<string | null>;
  commandRunner: (command: string, args: string[]) => Promise<CommandResult>;
}

export function createCodexAdapter(options: CodexAdapterOptions) {
  return {
    async detect() {
      const binary = await (options.which?.('codex') ?? Promise.resolve(null));
      return {
        installed: Boolean(binary),
        binaryPath: binary ?? undefined,
        installHelp: buildInstallHelp(options.platform ?? process.platform),
      };
    },
    async checkAuth() {
      const probes: Array<string[]> = [
        ['login', 'status'],
        ['auth', 'status'],
        ['login', '--status'],
        ['whoami'],
      ];

      for (const args of probes) {
        const result = await options.commandRunner('codex', args);
        const parsed = parseAuthOutput(result);
        if (parsed.status !== 'unknown') {
          return parsed;
        }
      }

      return {
        status: 'unknown' as const,
        details: 'Unable to determine login state from supported probes.',
      };
    },
    async runOfficialLogin() {
      return options.commandRunner('codex', ['login']);
    },
  };
}

export function createSystemCodexAdapter(overrides?: {
  whichImpl?: (name: string) => Promise<string | null>;
  runImpl?: (command: string, args: string[]) => Promise<CommandResult>;
}) {
  return createCodexAdapter({
    which: overrides?.whichImpl ?? defaultWhich,
    commandRunner: overrides?.runImpl ?? defaultRun,
  });
}

async function defaultWhich(name: string): Promise<string | null> {
  const result = await execa('which', [name], { reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function defaultRun(command: string, args: string[]): Promise<CommandResult> {
  const result = await execa(command, args, { reject: false, stdin: 'inherit', stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function buildInstallHelp(platform: NodeJS.Platform): string[] {
  const docs = 'https://github.com/openai/codex';
  const common = ['npm install -g @openai/codex', `Docs: ${docs}`];
  if (platform === 'win32') {
    return [...common, 'After install, reopen PowerShell or your terminal.'];
  }
  return common;
}

function parseAuthOutput(result: CommandResult) {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.exitCode === 0 && /(authenticated|logged in|signed in|workspace|api key)/.test(combined)) {
    return { status: 'authenticated' as const, details: combined.trim() };
  }
  if (/(not logged in|login required|unauthenticated|sign in)/.test(combined) || result.exitCode === 401) {
    return { status: 'unauthenticated' as const, details: combined.trim() };
  }
  return { status: 'unknown' as const, details: combined.trim() };
}

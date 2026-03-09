import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SnapshotStoreOptions {
  stateDir: string;
  configPath: string;
}

interface SnapshotState {
  schemaVersion: number;
  resolvedCodexConfigPath: string;
  hasOriginalConfig: boolean;
  originalCapturedAt?: string;
  lastGeneratedAt?: string;
  lastAppliedSource?: 'original' | 'betterconfig-latest' | 'history';
}

const STATE_FILE = 'state.json';
const SNAPSHOT_DIR = 'snapshots';
const ORIGINAL_FILE = 'original.toml';
const LATEST_FILE = 'betterconfig-latest.toml';
const HISTORY_DIR = 'history';

export async function createSnapshotStore(options: SnapshotStoreOptions) {
  await mkdir(path.join(options.stateDir, SNAPSHOT_DIR, HISTORY_DIR), { recursive: true });
  const store = {
    async captureOriginalFromDisk(): Promise<void> {
      const state = await readState(options);
      const originalPath = path.join(options.stateDir, SNAPSHOT_DIR, ORIGINAL_FILE);
      if (state.hasOriginalConfig) {
        return;
      }
      const original = await safeRead(options.configPath);
      if (original !== null) {
        await writeFile(originalPath, original, 'utf8');
      }
      await writeState(options, {
        ...state,
        hasOriginalConfig: original !== null,
        originalCapturedAt: new Date().toISOString(),
      });
    },
    async saveGenerated(content: string): Promise<void> {
      const current = await safeRead(options.configPath);
      if (current !== null) {
        await writeHistorySnapshot(options, current);
      }
      await writeFile(path.join(options.stateDir, SNAPSHOT_DIR, LATEST_FILE), content, 'utf8');
      await writeFile(options.configPath, content, 'utf8');
      const state = await readState(options);
      await writeState(options, {
        ...state,
        lastGeneratedAt: new Date().toISOString(),
        lastAppliedSource: 'betterconfig-latest',
      });
    },
    async restore(source: 'original' | 'betterconfig-latest'): Promise<boolean> {
      const filename = source === 'original' ? ORIGINAL_FILE : LATEST_FILE;
      const snapshot = await safeRead(path.join(options.stateDir, SNAPSHOT_DIR, filename));
      if (snapshot === null) {
        return false;
      }
      const current = await safeRead(options.configPath);
      if (current !== null) {
        await writeHistorySnapshot(options, current);
      }
      await writeFile(options.configPath, snapshot, 'utf8');
      const state = await readState(options);
      await writeState(options, {
        ...state,
        lastAppliedSource: source,
      });
      return true;
    },
    async readOriginal(): Promise<string | null> {
      return safeRead(path.join(options.stateDir, SNAPSHOT_DIR, ORIGINAL_FILE));
    },
    async readLatestGenerated(): Promise<string | null> {
      return safeRead(path.join(options.stateDir, SNAPSHOT_DIR, LATEST_FILE));
    },
    async readActiveConfig(): Promise<string | null> {
      return safeRead(options.configPath);
    },
    async listHistory(): Promise<string[]> {
      const historyPath = path.join(options.stateDir, SNAPSHOT_DIR, HISTORY_DIR);
      const items = await readdir(historyPath);
      return items.sort();
    },
    async restoreMostRecentHistory(): Promise<void> {
      const history = await store.listHistory();
      const latest = history.at(-1);
      if (!latest) {
        return;
      }
      const snapshot = await readFile(path.join(options.stateDir, SNAPSHOT_DIR, HISTORY_DIR, latest), 'utf8');
      await writeFile(options.configPath, snapshot, 'utf8');
      const state = await readState(options);
      await writeState(options, {
        ...state,
        lastAppliedSource: 'history',
      });
    },
  };

  return store;
}

async function readState(options: SnapshotStoreOptions): Promise<SnapshotState> {
  const filePath = path.join(options.stateDir, STATE_FILE);
  const current = await safeRead(filePath);
  if (!current) {
    return {
      schemaVersion: 1,
      resolvedCodexConfigPath: options.configPath,
      hasOriginalConfig: false,
    };
  }
  return JSON.parse(current) as SnapshotState;
}

async function writeState(options: SnapshotStoreOptions, state: SnapshotState): Promise<void> {
  await writeFile(path.join(options.stateDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    await stat(filePath);
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function writeHistorySnapshot(options: SnapshotStoreOptions, content: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const historyPath = path.join(options.stateDir, SNAPSHOT_DIR, HISTORY_DIR, `${timestamp}.toml`);
  await writeFile(historyPath, content, 'utf8');
}

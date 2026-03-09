import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createSnapshotStore } from '../../src/state/snapshot-store.js';

describe('snapshot store', () => {
  it('captures original config only once and restores snapshots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterconfig-state-'));
    const stateDir = path.join(root, '.betterconfig');
    const configPath = path.join(root, 'config.toml');

    await writeFile(configPath, 'model = "alpha"\n', 'utf8');

    const store = await createSnapshotStore({ stateDir, configPath });
    await store.captureOriginalFromDisk();
    await writeFile(configPath, 'model = "beta"\n', 'utf8');
    await store.captureOriginalFromDisk();
    await store.saveGenerated('model = "gamma"\n');
    await store.restore('original');

    expect(await store.readOriginal()).toBe('model = "alpha"\n');
    expect(await store.readLatestGenerated()).toBe('model = "gamma"\n');
    expect(await store.readActiveConfig()).toBe('model = "alpha"\n');
    expect((await store.listHistory()).length).toBeGreaterThan(0);
  });
});

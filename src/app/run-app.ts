import { homedir } from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

import type { ProbeResult } from '../providers/provider-prober.js';
import { probeOpenAICompatibleProvider } from '../providers/provider-prober.js';
import type { JsonValue, LoadedTemplate } from '../types.js';
import { buildMenuMetadata, type MenuGroup, type MenuGroupItem } from '../ui/menu-metadata.js';
import { renderBanner } from '../ui/banner.js';
import { AppCancelledError } from '../ui/clack-driver.js';
import type { MenuOption, PromptDriver } from '../ui/driver.js';
import { loadTemplate } from '../config/template-loader.js';
import { createExplanationCatalog } from '../explanations/catalog.js';
import { createConfigSession } from '../config/session.js';
import { generateConfigToml } from '../config/config-generator.js';
import { createSnapshotStore } from '../state/snapshot-store.js';
import { checkGeneratedConfig, type HealthResult } from '../health/health-checker.js';
import { getSchemaFieldMetadata } from '../schema/codex-schema.js';
import { createSystemCodexAdapter } from '../codex/codex-adapter.js';

const LANGUAGE_LABELS = {
  'zh-CN': '中文',
  en: 'English',
} as const;

type Language = keyof typeof LANGUAGE_LABELS;

type AdapterLike = {
  detect: () => Promise<{ installed: boolean; installHelp: string[] }>;
  checkAuth: () => Promise<{ status: 'authenticated' | 'unauthenticated' | 'unknown'; details: string }>;
  runOfficialLogin: () => Promise<{ exitCode: number; stdout: string; stderr: string }>;
};

const DIRECT_VALUE_OPTIONS: Record<string, string[]> = {
  approval_policy: ['untrusted', 'on-request', 'never', 'on-failure'],
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  web_search: ['disabled', 'cached', 'live'],
  service_tier: ['fast', 'flex'],
  personality: ['none', 'friendly', 'pragmatic'],
  model_reasoning_effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  plan_mode_reasoning_effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  model_reasoning_summary: ['auto', 'none', 'concise', 'detailed'],
  model_verbosity: ['low', 'medium', 'high'],
  file_opener: ['cursor', 'vscode', 'windsurf', 'zed', 'none'],
  "history.persistence": ['save-all', 'none'],
  "permissions.network.mode": ['limited', 'enabled'],
  "tui.alternate_screen": ['auto', 'on', 'off'],
  "tui.notification_method": ['auto', 'none'],
  "tui.theme": ['catppuccin-mocha', 'catppuccin-latte'],
};

export interface RunAppOptions {
  driver: PromptDriver;
  configPath?: string;
  stateDir?: string;
  template?: LoadedTemplate;
  codexAdapter?: AdapterLike;
  fetchImpl?: typeof fetch;
  healthCheck?: (input: { configText: string; providerResult?: ProbeResult }) => Promise<HealthResult>;
}

export async function runApp(options: RunAppOptions): Promise<{ status: 'needs-install' | 'written' | 'exited' | 'health-check-failed' }> {
  const driver = options.driver;
  const configPath = options.configPath ?? path.join(homedir(), '.codex', 'config.toml');
  const stateDir = options.stateDir ?? path.join(homedir(), '.betterconfig');
  const template = options.template ?? await loadTemplate();
  const explanations = await createExplanationCatalog(template);
  const menu = await buildMenuMetadata(template, explanations);
  const session = createConfigSession(template);
  const snapshots = await createSnapshotStore({ stateDir, configPath });
  const providerProbe = options.fetchImpl
    ? (inputUrl: string, apiKey: string) => probeOpenAICompatibleProvider({ inputUrl, apiKey, fetchImpl: options.fetchImpl })
    : (inputUrl: string, apiKey: string) => probeOpenAICompatibleProvider({ inputUrl, apiKey });

  driver.intro(renderBanner());
  const language = await selectLanguage(driver);
  await snapshots.captureOriginalFromDisk();

  const adapter = options.codexAdapter ?? createSystemCodexAdapter();

  const install = await adapter.detect();
  if (!install.installed) {
    driver.note(install.installHelp.join('\n'), language === 'zh-CN' ? '先安装 Codex' : 'Install Codex first');
    driver.outro(language === 'zh-CN' ? '安装完成后重新运行 betterconfig。' : 'Install Codex and run betterconfig again.');
    return { status: 'needs-install' };
  }

  let providerResult: ProbeResult | undefined;
  const auth = await adapter.checkAuth();
  if (auth.status !== 'authenticated') {
    const ready = await completeAuthGate(driver, language, adapter, providerProbe, session);
    providerResult = ready.providerResult;
  }

  while (true) {
    const topLevel = await driver.menu(
      { message: language === 'zh-CN' ? '请选择一个一级菜单' : 'Choose a top-level menu' },
      [
        { value: 'preset', icon: '⚡', label: language === 'zh-CN' ? '应用预设模板' : 'Apply preset', hint: language === 'zh-CN' ? '一键切换极致/日常两种预设配置。' : 'Switch between Extreme and Daily presets.' },
        ...menu.map((group) => ({
          value: group.id,
          icon: group.emoji,
          label: group.label[language],
          hint: group.description[language],
        })),
        { value: 'exit', icon: '🚪', label: language === 'zh-CN' ? '退出' : 'Exit', hint: language === 'zh-CN' ? '结束本次向导。' : 'Leave the wizard.' },
      ],
    );

    if (topLevel.action === 'back' || topLevel.value === 'exit') {
      driver.outro(language === 'zh-CN' ? '已退出 betterconfig。' : 'Exited betterconfig.');
      return { status: 'exited' };
    }

    if (topLevel.value === 'preset') {
      await handlePresetGroup(driver, language, session);
      continue;
    }

    const group = menu.find((item) => item.id === topLevel.value);
    if (!group) {
      continue;
    }

    if (group.id === 'snapshots') {
      await handleSnapshotsGroup(driver, language, group, snapshots);
      continue;
    }

    if (group.id === 'review-write') {
      const outcome = await handleReviewAndWriteGroup(driver, language, group, template, session, snapshots, providerResult, options.healthCheck);
      if (outcome === 'written') {
        driver.outro(language === 'zh-CN' ? '配置已成功写入。' : 'Configuration written successfully.');
        return { status: 'written' };
      }
      if (outcome === 'health-check-failed') {
        driver.outro(language === 'zh-CN' ? '健康检查失败，已恢复之前的配置。' : 'Health checks failed and the previous config was restored.');
        return { status: 'health-check-failed' };
      }
      continue;
    }

    await handleEditableGroup(driver, language, group, session, explanations);
  }
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

type PresetValues = Record<string, string | number | boolean | string[]>;

const PRESET_EXTREME: PresetValues = {
  model: 'gpt-5.4',
  review_model: 'gpt-5.4',
  model_provider: 'openai',
  approval_policy: 'never',
  sandbox_mode: 'danger-full-access',
  web_search: 'live',
  service_tier: 'fast',
  personality: 'pragmatic',
  model_reasoning_effort: 'xhigh',
  plan_mode_reasoning_effort: 'xhigh',
  model_reasoning_summary: 'detailed',
  model_verbosity: 'high',
  profile: 'extreme',
  allow_login_shell: true,
  check_for_update_on_startup: true,
  'features.multi_agent': true,
  'features.prevent_idle_sleep': true,
  'features.image_detail_original': true,
  'features.image_generation': true,
  'features.child_agents_md': true,
  'features.apps': true,
  'features.apps_mcp_gateway': true,
  'features.shell_snapshot': true,
  'features.shell_tool': true,
  'features.unified_exec': true,
  'features.undo': true,
  'features.sqlite': true,
  'features.fast_mode': true,
  'features.artifact': true,
  'agents.max_threads': 16,
  'agents.max_depth': 4,
};

const PRESET_DAILY: PresetValues = {
  model: 'gpt-5.4',
  review_model: 'gpt-5.4',
  model_provider: 'openai',
  approval_policy: 'on-request',
  sandbox_mode: 'workspace-write',
  web_search: 'cached',
  service_tier: 'fast',
  personality: 'pragmatic',
  model_reasoning_effort: 'medium',
  plan_mode_reasoning_effort: 'medium',
  model_reasoning_summary: 'auto',
  model_verbosity: 'medium',
  profile: 'daily',
  allow_login_shell: true,
  check_for_update_on_startup: true,
  'features.multi_agent': false,
  'features.prevent_idle_sleep': false,
  'features.image_detail_original': false,
  'features.image_generation': false,
  'features.child_agents_md': true,
  'features.apps': true,
  'features.apps_mcp_gateway': true,
  'features.shell_snapshot': true,
  'features.shell_tool': true,
  'features.unified_exec': true,
  'features.undo': true,
  'features.sqlite': true,
  'features.fast_mode': true,
  'features.artifact': true,
  'agents.max_threads': 8,
  'agents.max_depth': 2,
};

async function handlePresetGroup(
  driver: PromptDriver,
  language: Language,
  session: ReturnType<typeof createConfigSession>,
): Promise<void> {
  const choice = await driver.select(
    { message: language === 'zh-CN' ? '选择要应用的预设模板' : 'Choose a preset to apply' },
    [
      {
        value: 'extreme',
        label: language === 'zh-CN' ? '⚡ 极致模式' : '⚡ Extreme',
        hint: language === 'zh-CN'
          ? '最新模型 + xhigh 推理 + 全部工具 + 无审批沙箱 — 冲刺复杂任务。'
          : 'Latest model + xhigh reasoning + all tools + no-approval sandbox — for demanding tasks.',
      },
      {
        value: 'daily',
        label: language === 'zh-CN' ? '☀️ 日常模式' : '☀️ Daily',
        hint: language === 'zh-CN'
          ? 'medium 推理 + 按需审批 + workspace 沙箱 — 接近 Codex 开箱默认值。'
          : 'Medium reasoning + on-request approval + workspace sandbox — close to Codex defaults.',
      },
    ],
  );

  const preset = choice === 'extreme' ? PRESET_EXTREME : PRESET_DAILY;
  const presetName = choice === 'extreme'
    ? (language === 'zh-CN' ? '极致模式' : 'Extreme')
    : (language === 'zh-CN' ? '日常模式' : 'Daily');

  for (const [path, value] of Object.entries(preset)) {
    session.set(path, value as import('../types.js').JsonValue);
  }

  driver.note(
    language === 'zh-CN'
      ? `已将 ${Object.keys(preset).length} 项设置为「${presetName}」预设值。\n前往「预览与写入」确认并写入配置文件。`
      : `Applied ${Object.keys(preset).length} settings from the "${presetName}" preset.\nGo to "Review & Write" to preview and write the config.`,
    language === 'zh-CN' ? `预设已应用：${presetName}` : `Preset applied: ${presetName}`,
  );
}

async function selectLanguage(driver: PromptDriver): Promise<Language> {
  return (await driver.select(
    { message: 'Choose language / 选择语言' },
    [
      { value: 'zh-CN', label: '🇨🇳 中文', hint: '使用中文解释与菜单。' },
      { value: 'en', label: '🇺🇸 English', hint: 'Use English labels and explanations.' },
    ],
  )) as Language;
}

async function completeAuthGate(
  driver: PromptDriver,
  language: Language,
  adapter: AdapterLike,
  probe: (inputUrl: string, apiKey: string) => Promise<ProbeResult>,
  session: ReturnType<typeof createConfigSession>,
): Promise<{ providerResult?: ProbeResult }> {
  while (true) {
    const choice = await driver.select(
      { message: language === 'zh-CN' ? '未检测到可用登录态，先完成哪一种接入？' : 'No ready login was detected. How do you want to connect first?' },
      [
        { value: 'official', label: language === 'zh-CN' ? '官方登录' : 'Official login', hint: language === 'zh-CN' ? '直接拉起 codex login。' : 'Launches `codex login`.' },
        { value: 'third-party', label: language === 'zh-CN' ? '第三方 OpenAI 兼容' : 'Third-party OpenAI-compatible', hint: language === 'zh-CN' ? '填写 URL 和 Key，并立即测试。' : 'Enter a URL and key, then test immediately.' },
        { value: 'skip', label: language === 'zh-CN' ? '跳过（已手动配置）' : 'Skip (already configured manually)', hint: language === 'zh-CN' ? '已通过环境变量等方式自行配置，直接继续。' : 'You have set credentials another way and want to proceed.' },
      ],
    );

    if (choice === 'skip') {
      return {};
    }

    if (choice === 'official') {
      await adapter.runOfficialLogin();
      const auth = await adapter.checkAuth();
      if (auth.status === 'authenticated') {
        driver.note(language === 'zh-CN' ? '官方登录已通过。' : 'Official login is ready.', language === 'zh-CN' ? '认证完成' : 'Authenticated');
        return {};
      }
      driver.note(language === 'zh-CN' ? '官方登录尚未完成，请重试或改走第三方。' : 'Official login is still not ready. Retry or choose third-party access.', language === 'zh-CN' ? '仍未登录' : 'Still not logged in');
      continue;
    }

    const inputUrl = await driver.text({ message: language === 'zh-CN' ? '请输入第三方 Base URL 或完整接口 URL' : 'Enter the third-party base URL or a full endpoint URL' });
    const apiKey = await driver.password({ message: language === 'zh-CN' ? '请输入用于测试的 API Key' : 'Enter the API key used for probing' });
    const result = await probe(inputUrl, apiKey);
    if (!result.ok) {
      driver.note(result.error.message, language === 'zh-CN' ? '第三方接入失败' : 'Third-party probe failed');
      continue;
    }

    const model = result.models.length > 0
      ? await driver.select(
          { message: language === 'zh-CN' ? '请选择要写入的模型' : 'Choose the model to write into config' },
          result.models.map((item) => ({ value: item, label: item })),
        )
      : await driver.text({ message: language === 'zh-CN' ? '未探测到模型，请手动输入模型名' : 'No models were returned, so enter a model name manually' });
    const providerName = await driver.text({
      message: language === 'zh-CN' ? '请输入 provider 名称' : 'Choose a provider name',
      initialValue: 'custom',
    });
    const storageMode = await driver.select(
      { message: language === 'zh-CN' ? '如何保存这个 Key？' : 'How should this key be stored?' },
      [
        { value: 'env', label: language === 'zh-CN' ? '环境变量（推荐）' : 'Environment variable (Recommended)', hint: language === 'zh-CN' ? '更安全，不把 Key 直接写进 config。' : 'Safer because the key stays out of config.toml.' },
        { value: 'token', label: language === 'zh-CN' ? '直接写入 config' : 'Store directly in config', hint: language === 'zh-CN' ? '更方便，但安全性较低。' : 'More convenient but less secure.' },
      ],
    );

    // The template only contains a 'custom' placeholder entry under model_providers.
    // We always write into that fixed slot and set the 'name' field to whatever
    // the user typed, so the generated TOML always contains [model_providers.custom].
    const PROVIDER_SLOT = 'custom';
    session.set('model_provider', providerName);
    session.set('model', model);
    session.set('review_model', model);
    session.set(`model_providers.${PROVIDER_SLOT}.name`, providerName);
    session.set(`model_providers.${PROVIDER_SLOT}.base_url`, result.baseUrl);
    session.set(`model_providers.${PROVIDER_SLOT}.wire_api`, 'responses');
    session.set(`model_providers.${PROVIDER_SLOT}.requires_openai_auth`, false);

    if (storageMode === 'env') {
      const envName = await driver.text({
        message: language === 'zh-CN' ? '请输入存放 Key 的环境变量名' : 'Enter the environment variable name that will store the key',
        initialValue: 'OPENAI_API_KEY',
      });
      session.set(`model_providers.${PROVIDER_SLOT}.env_key`, envName);
      session.set(
        `model_providers.${PROVIDER_SLOT}.env_key_instructions`,
        language === 'zh-CN'
          ? `请在启动 Codex 前设置 ${envName} 环境变量。`
          : `Set the ${envName} environment variable before starting Codex.`,
      );
      driver.note(
        language === 'zh-CN'
          ? `刚才输入的 Key 仅用于测试；最终会从 ${envName} 读取。`
          : `The key you entered was used only for probing; the saved config will read ${envName}.`,
        language === 'zh-CN' ? '安全提示' : 'Security note',
      );
    } else {
      session.set(`model_providers.${PROVIDER_SLOT}.experimental_bearer_token`, apiKey);
    }

    driver.note(language === 'zh-CN' ? '第三方接入测试通过。' : 'Third-party access is ready.', language === 'zh-CN' ? '接入成功' : 'Connected');
    return { providerResult: result };
  }
}

async function handleEditableGroup(
  driver: PromptDriver,
  language: Language,
  group: MenuGroup,
  session: ReturnType<typeof createConfigSession>,
  explanations: Map<string, { zhCN: string; en: string }>,
): Promise<void> {
  while (true) {
    const choice = await driver.menu(
      { message: `${group.emoji} ${group.label[language]}` },
      group.items.map((item) => toGroupMenuOption(item, group, session, explanations, language)),
    );

    if (choice.action === 'back') {
      return;
    }

    const item = group.items.find((candidate) => candidate.id === choice.value);
    if (!item) {
      continue;
    }

    if (item.kind === 'action' && item.actionId === 'apply-group-defaults') {
      const fieldPaths = group.items
        .filter((candidate): candidate is MenuGroupItem & { kind: 'field'; fieldPath: string } => candidate.kind === 'field' && Boolean(candidate.fieldPath))
        .map((candidate) => candidate.fieldPath);
      session.applyDefaults(fieldPaths);
      driver.note(language === 'zh-CN' ? '本组已恢复模板默认值。' : 'This group has been reset to the template defaults.', language === 'zh-CN' ? '已恢复默认值' : 'Defaults applied');
      continue;
    }

    if (item.kind !== 'field' || !item.fieldPath) {
      continue;
    }

    const current = session.get(item.fieldPath);
    if (choice.action === 'space' && typeof current === 'boolean') {
      session.set(item.fieldPath, !current);
      continue;
    }

    if (choice.action === 'space') {
      continue;
    }

    await editFieldDirect(driver, language, item.fieldPath, session, explanations);
  }
}

async function editFieldDirect(
  driver: PromptDriver,
  language: Language,
  fieldPath: string,
  session: ReturnType<typeof createConfigSession>,
  explanations: Map<string, { zhCN: string; en: string }>,
): Promise<void> {
  const current = session.get(fieldPath);
  const explanation = getLocalizedExplanation(explanations.get(fieldPath), language);

  try {
    if (typeof current === 'boolean') {
      const next = await driver.select(
        { message: `${fieldPath} · ${explanation}` },
        [
          { value: 'true', label: 'true', hint: language === 'zh-CN' ? '启用' : 'Enable' },
          { value: 'false', label: 'false', hint: language === 'zh-CN' ? '禁用' : 'Disable' },
        ],
      );
      session.set(fieldPath, next === 'true');
      return;
    }

    const selectableOptions = await getSelectableOptions(fieldPath);
    if (selectableOptions.length > 0) {
      const next = await driver.select(
        { message: `${fieldPath} · ${explanation}` },
        selectableOptions.map((value) => ({
          value,
          label: value,
          hint: current === value ? (language === 'zh-CN' ? '当前值' : 'Current') : undefined,
        })),
      );
      session.set(fieldPath, next);
      return;
    }

    const raw = await driver.text({
      message: `${fieldPath} · ${explanation}`,
      initialValue: typeof current === 'string' ? current : current !== undefined ? formatForInput(current) : undefined,
      placeholder: language === 'zh-CN' ? '输入新值' : 'Enter a new value',
    });
    session.set(fieldPath, parseEditableValue(raw, current));
  } catch (error) {
    if (error instanceof AppCancelledError) {
      return;
    }
    throw error;
  }
}

async function handleSnapshotsGroup(
  driver: PromptDriver,
  language: Language,
  group: MenuGroup,
  snapshots: Awaited<ReturnType<typeof createSnapshotStore>>,
): Promise<void> {
  const choice = await driver.menu(
    { message: `${group.emoji} ${group.label[language]}` },
    group.items.map((item) => toActionMenuOption(item, language)),
  );
  if (choice.action === 'back') {
    return;
  }
  const confirmed = await driver.confirm({ message: language === 'zh-CN' ? '确认要覆盖当前 config.toml 吗？' : 'Do you want to replace the current config.toml?' });
  if (!confirmed) {
    return;
  }
  let ok = false;
  if (choice.value === 'restore-original') {
    ok = await snapshots.restore('original');
  }
  if (choice.value === 'restore-latest') {
    ok = await snapshots.restore('betterconfig-latest');
  }
  if (!ok) {
    driver.note(
      language === 'zh-CN' ? '未找到对应的快照文件，操作已跳过。' : 'No snapshot file was found for that option. Nothing was changed.',
      language === 'zh-CN' ? '快照不存在' : 'Snapshot not found',
    );
  } else {
    driver.note(
      language === 'zh-CN' ? 'config.toml 已成功还原。' : 'config.toml has been restored successfully.',
      language === 'zh-CN' ? '还原成功' : 'Restored',
    );
  }
}

async function handleReviewAndWriteGroup(
  driver: PromptDriver,
  language: Language,
  group: MenuGroup,
  template: LoadedTemplate,
  session: ReturnType<typeof createConfigSession>,
  snapshots: Awaited<ReturnType<typeof createSnapshotStore>>,
  providerResult: ProbeResult | undefined,
  customHealthCheck?: (input: { configText: string; providerResult?: ProbeResult }) => Promise<HealthResult>,
): Promise<'stay' | 'written' | 'health-check-failed'> {
  const choice = await driver.menu(
    { message: `${group.emoji} ${group.label[language]}` },
    group.items.map((item) => toActionMenuOption(item, language)),
  );
  if (choice.action === 'back' || !choice.value) {
    return 'stay';
  }

  const configText = generateConfigToml(template, session);
  if (choice.value === 'preview-config') {
    driver.note(configText, language === 'zh-CN' ? '配置预览' : 'Config preview');
    return 'stay';
  }

  const confirmed = await driver.confirm({ message: language === 'zh-CN' ? '确认写入这份 config.toml 吗？' : 'Write this config.toml now?' });
  if (!confirmed) {
    return 'stay';
  }

  await snapshots.saveGenerated(configText);
  const health = customHealthCheck
    ? await customHealthCheck({ configText, providerResult })
    : await checkGeneratedConfig({
        configText,
        providerCheck: providerResult && providerResult.ok
          ? async () => ({ ok: true })
          : undefined,
      });

  if (!health.ok) {
    await snapshots.restoreMostRecentHistory();
    driver.note(health.issues.map((issue) => issue.message).join('\n'), language === 'zh-CN' ? '健康检查失败' : 'Health checks failed');
    return 'health-check-failed';
  }
  return 'written';
}

function toGroupMenuOption(
  item: MenuGroupItem,
  group: MenuGroup,
  session: ReturnType<typeof createConfigSession>,
  explanations: Map<string, { zhCN: string; en: string }>,
  language: Language,
): MenuOption {
  if (item.kind === 'action') {
    return {
      value: item.id,
      icon: '✨',
      label: language === 'zh-CN' ? '应用本组默认配置' : 'Apply group defaults',
      hint: language === 'zh-CN' ? `把 ${group.label[language]} 这一组恢复到模板默认值。` : `Reset ${group.label[language]} to the template defaults.`,
    };
  }

  const fieldPath = item.fieldPath!;
  const value = session.get(fieldPath);
  const explanation = getLocalizedExplanation(explanations.get(fieldPath), language);
  return {
    value: fieldPath,
    label: fieldPath,
    hint: buildFieldHint(value, explanation, language),
    kind: typeof value === 'boolean' ? 'toggle' : 'default',
    checked: typeof value === 'boolean' ? value : undefined,
  };
}

function toActionMenuOption(item: MenuGroupItem, language: Language): MenuOption {
  const copy: Record<NonNullable<MenuGroupItem['actionId']>, { label: string; labelZh: string; hint: string; hintZh: string }> = {
    'apply-group-defaults': { label: 'Apply group defaults', labelZh: '应用本组默认配置', hint: 'Reset this group to the template defaults.', hintZh: '把这一组恢复到模板默认值。' },
    'restore-original': { label: 'Restore original config', labelZh: '切换到原始配置', hint: 'Replace the active config with the captured original snapshot.', hintZh: '用首次保存的原始配置覆盖当前配置。' },
    'restore-latest': { label: 'Restore latest betterconfig config', labelZh: '切换到最近 betterconfig 配置', hint: 'Replace the active config with the latest generated snapshot.', hintZh: '用最近一次生成的配置覆盖当前配置。' },
    'preview-config': { label: 'Preview config', labelZh: '预览配置', hint: 'Show the current generated config without writing it.', hintZh: '查看当前将要生成的配置，但不写入。' },
    'write-config': { label: 'Write config', labelZh: '写入配置', hint: 'Write the current generated config to Codex.', hintZh: '把当前配置写入 Codex。' },
  };
  const current = copy[item.actionId!];
  return {
    value: item.id,
    icon: actionIcon(item.actionId!),
    label: language === 'zh-CN' ? current.labelZh : current.label,
    hint: language === 'zh-CN' ? current.hintZh : current.hint,
  };
}


function buildFieldHint(value: unknown, explanation: string, language: Language): string {
  const current = `${language === 'zh-CN' ? '当前值' : 'Current'}: ${formatSessionValue(value, language)}`;
  return explanation ? `${current} — ${explanation}` : current;
}

function actionIcon(actionId: NonNullable<MenuGroupItem['actionId']>): string | undefined {
  const icons: Record<NonNullable<MenuGroupItem['actionId']>, string> = {
    'apply-group-defaults': '✨',
    'restore-original': '↩️',
    'restore-latest': '🔄',
    'preview-config': '👁️',
    'write-config': '📝',
  };
  return icons[actionId];
}

async function getSelectableOptions(fieldPath: string): Promise<string[]> {
  const direct = DIRECT_VALUE_OPTIONS[fieldPath];
  if (direct) {
    return direct;
  }
  const schema = await getSchemaFieldMetadata(fieldPath);
  if (schema?.enumValues && schema.enumValues.length > 1) {
    return schema.enumValues;
  }
  return [];
}

function parseEditableValue(raw: string, current: unknown): JsonValue | undefined {
  if (typeof current === 'number') {
    if (raw.trim() === '') {
      return undefined;
    }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? current as JsonValue : parsed;
  }
  if (typeof current === 'boolean') {
    return raw === 'true';
  }
  if (Array.isArray(current) || (current && typeof current === 'object')) {
    try {
      const parsed = TOML.parse(`value = ${raw}`) as { value?: JsonValue };
      return parsed.value;
    } catch {
      return current as JsonValue;
    }
  }
  return raw;
}

function getLocalizedExplanation(
  explanation: { zhCN: string; en: string } | undefined,
  language: Language,
): string {
  if (!explanation) {
    return '';
  }
  return language === 'zh-CN' ? explanation.zhCN : explanation.en;
}

function formatSessionValue(value: unknown, language: Language): string {
  if (value === undefined) {
    return language === 'zh-CN' ? '未设置' : 'unset';
  }
  if (typeof value === 'string') {
    return value || (language === 'zh-CN' ? '（空字符串）' : '(empty string)');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? (language === 'zh-CN' ? '（空列表）' : '(empty list)')
      : `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  }
  return JSON.stringify(value);
}

function formatForInput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}


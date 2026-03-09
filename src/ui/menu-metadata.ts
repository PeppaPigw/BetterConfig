import type { ExplanationRecord, LoadedTemplate } from '../types.js';

export interface MenuGroupItem {
  id: string;
  kind: 'field' | 'action';
  fieldPath?: string;
  actionId?: 'apply-group-defaults' | 'restore-original' | 'restore-latest' | 'preview-config' | 'write-config';
}

export interface MenuGroup {
  id: string;
  emoji: string;
  label: { 'zh-CN': string; en: string };
  description: { 'zh-CN': string; en: string };
  items: MenuGroupItem[];
}

const COMMON_PATHS = [
  'model',
  'review_model',
  'model_provider',
  'approval_policy',
  'sandbox_mode',
  'web_search',
  'service_tier',
  'personality',
  'allow_login_shell',
  'check_for_update_on_startup',
  'profile',
];

const GROUP_ORDER = [
  'common',
  'auth-providers',
  'models-reasoning',
  'approvals-sandbox',
  'network-search',
  'interface-ux',
  'tools-features',
  'agents-skills',
  'mcp-integrations',
  'paths-storage',
  'advanced',
  'snapshots',
  'review-write',
] as const;

export async function buildMenuMetadata(
  template: LoadedTemplate,
  _explanations: Map<string, ExplanationRecord>,
): Promise<MenuGroup[]> {
  const groups = new Map<string, MenuGroup>();
  for (const groupId of GROUP_ORDER) {
    groups.set(groupId, createGroup(groupId));
  }

  for (const groupId of GROUP_ORDER) {
    const group = groups.get(groupId)!;
    if (groupId === 'snapshots') {
      group.items.push(
        { id: 'restore-original', kind: 'action', actionId: 'restore-original' },
        { id: 'restore-latest', kind: 'action', actionId: 'restore-latest' },
      );
      continue;
    }
    if (groupId === 'review-write') {
      group.items.push(
        { id: 'preview-config', kind: 'action', actionId: 'preview-config' },
        { id: 'write-config', kind: 'action', actionId: 'write-config' },
      );
      continue;
    }
    group.items.push({ id: `${groupId}:defaults`, kind: 'action', actionId: 'apply-group-defaults' });
  }

  for (const entry of template.entries) {
    const groupId = classifyGroup(entry.path);
    const group = groups.get(groupId);
    if (!group || groupId === 'snapshots' || groupId === 'review-write') {
      continue;
    }
    group.items.push({
      id: entry.path,
      kind: 'field',
      fieldPath: entry.path,
    });
  }

  return GROUP_ORDER.map((groupId) => groups.get(groupId)!).filter(Boolean);
}

function classifyGroup(path: string): string {
  if (COMMON_PATHS.includes(path)) return 'common';
  if (path.startsWith('model_providers.') || ['chatgpt_base_url', 'cli_auth_credentials_store', 'mcp_oauth_credentials_store', 'forced_login_method', 'forced_chatgpt_workspace_id'].includes(path)) {
    return 'auth-providers';
  }
  if (path.startsWith('mcp_servers.') || path.startsWith('otel.')) return 'mcp-integrations';
  if (path.startsWith('features.') || path.startsWith('tools.') || path.startsWith('apps.')) return 'tools-features';
  if (path.startsWith('agents.') || path.startsWith('skills.')) return 'agents-skills';
  if (path.startsWith('permissions.network.') || ['web_search', 'proxy_url', 'socks_url', 'admin_url'].includes(path)) return 'network-search';
  if (path.startsWith('sandbox_workspace_write.') || path.startsWith('shell_environment_policy.') || ['approval_policy', 'sandbox_mode', 'allow_login_shell', 'background_terminal_max_timeout', 'tool_output_token_limit'].includes(path)) return 'approvals-sandbox';
  if (path.startsWith('tui.') || path.startsWith('history.') || path.startsWith('notice.') || path.startsWith('analytics.') || path.startsWith('feedback.') || ['disable_paste_burst', 'hide_agent_reasoning', 'show_raw_agent_reasoning', 'suppress_unstable_features_warning', 'windows_wsl_setup_acknowledged'].includes(path)) return 'interface-ux';
  if (path.startsWith('profiles.')) return 'advanced';
  if (path.startsWith('projects.') || /(log_dir|sqlite_home|model_catalog_json|model_instructions_file|experimental_compact_prompt_file|js_repl_node_path|js_repl_node_module_dirs|zsh_path|project_doc_max_bytes|project_doc_fallback_filenames|project_root_markers)/.test(path)) return 'paths-storage';
  if (['model', 'review_model', 'model_reasoning_effort', 'plan_mode_reasoning_effort', 'model_reasoning_summary', 'model_supports_reasoning_summaries', 'model_verbosity', 'service_tier', 'personality', 'profile'].includes(path)) return 'models-reasoning';
  return 'advanced';
}

function createGroup(id: string): MenuGroup {
  const labels: Record<string, [string, string, string, string, string]> = {
    common: ['✨', 'Common', 'Common', '最常用的一组设置入口。', 'Your most frequently used settings.'],
    'auth-providers': ['🔐', '认证与 Provider', 'Auth & Providers', '官方登录和第三方接入。', 'Official login and third-party access.'],
    'models-reasoning': ['🧠', '模型与推理', 'Models & Reasoning', '模型、推理和输出风格。', 'Models, reasoning, and verbosity.'],
    'approvals-sandbox': ['🛡️', '审批与沙箱', 'Approvals & Sandbox', '命令审批、沙箱和 shell 环境。', 'Command approvals, sandboxing, and shell environment.'],
    'network-search': ['🌐', '网络与搜索', 'Network & Search', '联网搜索、代理和网络权限。', 'Web search, proxies, and network permissions.'],
    'interface-ux': ['🖥️', '界面与体验', 'Interface & UX', '终端显示和交互体验。', 'Terminal display and interaction experience.'],
    'tools-features': ['🧰', '工具与功能', 'Tools & Features', '工具、feature flags 与 Apps。', 'Tools, feature flags, and apps.'],
    'agents-skills': ['🤖', 'Agents 与 Skills', 'Agents & Skills', '多 agent 与 skill 相关设置。', 'Agent and skill related settings.'],
    'mcp-integrations': ['🔌', 'MCP 与集成', 'MCP & Integrations', 'MCP、Apps、OTEL 等集成项。', 'MCP, apps, OTEL, and integration settings.'],
    'paths-storage': ['📁', '路径与存储', 'Paths & Storage', '本地目录、状态与项目路径。', 'Local directories, state, and project paths.'],
    advanced: ['🧪', '高级', 'Advanced', '实验、legacy 与少见选项。', 'Experimental, legacy, and uncommon options.'],
    snapshots: ['🔄', '快照切换', 'Snapshots', '原始配置、最近配置与历史恢复。', 'Original, latest, and history-based restores.'],
    'review-write': ['📝', '预览与写入', 'Review & Write', '预览最终配置并写入到 Codex。', 'Preview the final config and write it to Codex.'],
  };
  const [emoji, zh, en, zhDesc, enDesc] = labels[id] ?? ['🧩', id, id, id, id];
  return {
    id,
    emoji,
    label: { 'zh-CN': zh, en },
    description: { 'zh-CN': zhDesc, en: enDesc },
    items: [],
  };
}

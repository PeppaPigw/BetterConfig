import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ExplanationRecord, LoadedTemplate } from '../types.js';
import { getSchemaFieldMetadata } from '../schema/codex-schema.js';

interface ExplanationOverrides {
  [path: string]: Partial<Omit<ExplanationRecord, 'path' | 'source'>>;
}

export async function createExplanationCatalog(template: LoadedTemplate): Promise<Map<string, ExplanationRecord>> {
  const overrides = await loadOverrides();
  const catalog = new Map<string, ExplanationRecord>();

  for (const entry of template.entries) {
    const override = overrides[entry.path];
    const schema = await getSchemaFieldMetadata(entry.path);
    const derived = derivePatternBasedExplanation(entry.path);
    const zhCN = override?.zhCN ?? entry.descriptionZhCN ?? derived.zhCN ?? translateSchemaDescription(schema?.description) ?? fallbackDescription(entry.path, 'zh-CN');
    const en = override?.en ?? derived.en ?? shortenEnglish(schema?.description) ?? translateChineseHint(entry.descriptionZhCN) ?? fallbackDescription(entry.path, 'en');
    const source: ExplanationRecord['source'] = override?.zhCN || override?.en
      ? 'override'
      : entry.descriptionZhCN
        ? 'template-comment'
        : schema?.description
          ? 'schema'
          : 'fallback';

    catalog.set(entry.path, {
      path: entry.path,
      zhCN,
      en,
      source,
    });
  }

  return catalog;
}

async function loadOverrides(): Promise<ExplanationOverrides> {
  const sourcePath = path.resolve('data/explanations.overrides.json');
  try {
    const source = await readFile(sourcePath, 'utf8');
    return JSON.parse(source) as ExplanationOverrides;
  } catch {
    return {};
  }
}

function shortenEnglish(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }
  return cleanSentence(description)
    .replace(/Optional /gi, '')
    .replace(/^Whether /, 'Controls whether ')
    .replace(/\.$/, '');
}

function translateSchemaDescription(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }

  const normalized = cleanSentence(description).replace(/\.$/, '');
  const replacements: Array<[RegExp, string]> = [
    [/Default approval policy for executing commands/i, '控制执行命令时默认采用哪种审批策略'],
    [/Sandbox mode to use/i, '控制命令运行时使用的沙箱级别'],
    [/Controls the web search tool mode: disabled, cached, or live/i, '控制联网搜索是关闭、缓存搜索还是实时搜索'],
    [/Optional explicit service tier preference for new turns \(`fast` or `flex`\)/i, '控制新回合优先使用 fast 还是 flex 服务档位'],
    [/Optionally specify a personality for the model/i, '控制模型默认采用的表达风格'],
    [/Enable the `view_image` tool that lets the agent attach local images/i, '控制是否启用本地图像查看工具'],
    [/Whether tools are enabled by default for this app/i, '控制这个应用的工具是否默认启用'],
    [/When `false`, Codex does not surface this app/i, '控制这个应用是否在 Codex 中显示'],
    [/Default maximum runtime in seconds for agent job workers/i, '控制 agent 任务的默认最长运行时间（秒）'],
    [/Maximum number of agent threads that can be open concurrently/i, '控制最多可同时存在多少个 agent 线程'],
    [/Maximum nesting depth allowed for spawned agent threads/i, '控制 agent 线程允许的最大嵌套深度'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(normalized)) {
      return replacement;
    }
  }

  if (/^Enable /i.test(normalized)) {
    return normalized.replace(/^Enable /i, '启用').replace(/ tool/i, '工具');
  }
  if (/^Disable /i.test(normalized)) {
    return normalized.replace(/^Disable /i, '禁用');
  }
  if (/^Whether /i.test(normalized)) {
    return normalized.replace(/^Whether /i, '控制是否');
  }
  if (/^Default /i.test(normalized)) {
    return normalized.replace(/^Default /i, '默认');
  }
  if (/^Controls /i.test(normalized)) {
    return normalized.replace(/^Controls /i, '控制');
  }
  return normalized;
}

function translateChineseHint(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }

  const replacements: Array<[RegExp, string]> = [
    [/默认主模型：当前通用首选。?/, 'Sets the default main model for most sessions'],
    [/\/review 也保持同模型，减少行为差异。?/, 'Keeps `/review` on the same model to reduce behavior drift'],
    [/推荐平衡点：必要时才停下来问；比 never 更稳，比 untrusted 更顺手。?/, 'Uses a balanced approval policy that asks only when needed'],
    [/推荐平衡点：可改当前工作区，但默认不放开额外路径与网络。?/, 'Lets Codex edit the current workspace without opening extra paths or network access'],
    [/默认用缓存检索：快、稳、较少暴露到任意实时网页。?/, 'Uses cached web results for faster and steadier search behavior'],
    [/更偏低延迟；若你的计划不支持或你更看重稳定配额，可改为 "flex"。?/, 'Prefers the low-latency service tier by default'],
    [/写代码\/改配置时更实用；比 friendly 更克制。?/, 'Uses a practical response style suited for coding and config work'],
    [/更贴近日常终端环境，语言管理器\/版本管理器兼容性更好。?/, 'Uses a login shell so common local tooling works more reliably'],
    [/建议开启，方便及时获得行为修复。?/, 'Checks for Codex updates on startup'],
    [/凭据优先走更合适的系统存储。?/, 'Stores CLI credentials in the most appropriate secure location'],
    [/MCP OAuth 也优先自动选择安全存储。?/, 'Stores MCP OAuth credentials in the most appropriate secure location'],
    [/空字符串 = 关闭自动 Co-authored-by，避免留下错误署名。?/, 'Clears automatic Co-authored-by attribution'],
    [/旧兼容项：现代配置更推荐走 \[features\]。?/, 'Legacy compatibility toggle that is usually superseded by [features]'],
    [/官方推荐：原生 Windows 下优先 elevated。?/, 'Chooses the recommended Windows sandbox backend'],
    [/workspace-write 下默认仍不开外网；需要时再精确放开。?/, 'Keeps network access disabled under workspace-write unless you explicitly allow it'],
    [/最佳默认是只写当前工作区；不要预先扩权到别处。?/, 'Keeps write access limited to the current workspace by default'],
    [/保留默认 KEY\/SECRET\/TOKEN 过滤。?/, 'Keeps the default secret-like environment variable filters'],
    [/统一编码行为，跨工具更稳。?/, 'Sets environment variables used to keep terminal encoding behavior stable'],
    [/读用户 shell profile 虽更像手工终端，但也更不稳定。?/, 'Reads the user shell profile at startup, which is more realistic but less predictable'],
    [/Connectors \/ Apps 很有用；不开启也不会自动乱用。?/, 'Turns app and connector support on or off'],
    [/生成表格\/幻灯片等原生 artifact 时更方便。?/, 'Turns artifact generation support on or off'],
    [/没有 AGENTS\.md 时也补 scope 提示，减少多 agent 误解。?/, 'Adds extra child-agent scope guidance even when AGENTS.md is missing'],
    [/兼容旧开关；当前构建即使不写通常也可用。?/, 'Legacy compatibility flag for collaboration modes'],
    [/当前仍偏实验；默认关，减少中断。?/, 'Still experimental, so it stays off by default'],
    [/仍属实验能力；默认关，避免复杂度和资源开销。?/, 'Still experimental, so it stays off by default to reduce complexity'],
    [/Windows 下强烈建议开；非 Windows 无害。?/, 'Strongly recommended on Windows and harmless elsewhere'],
    [/长任务更省心。?/, 'Prevents the system from sleeping during long-running tasks'],
    [/legacy，不建议依赖。?/, 'Legacy option that is usually better left disabled'],
    [/仍偏实验；默认关。?/, 'Still experimental, so it stays off by default'],
    [/默认关，界面更干净。?/, 'Keeps this off by default for a cleaner interface'],
    [/重复命令更快。?/, 'Caches shell environment snapshots so repeated commands start faster'],
    [/Skill 覆盖与启停设置。?/, 'Lists per-skill enable and disable overrides'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(description)) {
      return replacement;
    }
  }

  return undefined;
}

function derivePatternBasedExplanation(pathKey: string): { zhCN?: string; en?: string } {
  if (pathKey.startsWith('features.')) {
    const feature = pathKey.slice('features.'.length);
    return {
      zhCN: `控制 ${feature} 这个功能开关是否启用。`,
      en: `Turns the ${feature} feature flag on or off.`,
    };
  }

  const profileFeatureMatch = pathKey.match(/^profiles\.([^.]+)\.features\.(.+)$/);
  if (profileFeatureMatch) {
    const [, profile, feature] = profileFeatureMatch;
    return {
      zhCN: `控制 ${profile} profile 里 ${feature} 这个功能开关是否启用。`,
      en: `Turns the ${feature} feature flag on or off inside the ${profile} profile.`,
    };
  }

  const profileMatch = pathKey.match(/^profiles\.([^.]+)\.(.+)$/);
  if (profileMatch) {
    const [, profile, rest] = profileMatch;
    return {
      zhCN: `控制启用 ${profile} profile 时 ${rest} 采用什么值。`,
      en: `Overrides ${rest} when the ${profile} profile is active.`,
    };
  }


  const rejectMatch = pathKey.match(/^approval_policy\.reject\.(.+)$/);
  if (rejectMatch) {
    const [, target] = rejectMatch;
    return {
      zhCN: `控制是否默认拒绝来自 ${target} 的审批请求。`,
      en: `Controls whether approval requests from ${target} are rejected automatically.`,
    };
  }

  const audioMatch = pathKey.match(/^audio\.(microphone|speaker)$/);
  if (audioMatch) {
    const [, device] = audioMatch;
    return {
      zhCN: `设置语音能力默认使用哪一个 ${device === 'microphone' ? '麦克风' : '扬声器'} 设备。`,
      en: `Chooses which ${device} device voice features use by default.`,
    };
  }

  const pluginMatch = pathKey.match(/^plugins\.([^.]+)\.(.+)$/);
  if (pluginMatch) {
    const [, pluginName, feature] = pluginMatch;
    return {
      zhCN: `控制插件 ${pluginName} 是否启用 ${feature} 这项能力。`,
      en: `Controls whether the ${pluginName} plugin enables the ${feature} capability.`,
    };
  }

  if (pathKey.startsWith('permissions.network.')) {
    const key = pathKey.slice('permissions.network.'.length);
    const labels: Record<string, { zhCN: string; en: string }> = {
      enabled: { zhCN: '控制是否启用受管网络权限层。', en: 'Controls whether the managed network permission layer is enabled.' },
      mode: { zhCN: '控制受管网络层采用哪一种限制模式。', en: 'Chooses which restriction mode the managed network layer uses.' },
      allowed_domains: { zhCN: '列出受管网络层明确允许访问的域名。', en: 'Lists the domains that the managed network layer explicitly allows.' },
      denied_domains: { zhCN: '列出受管网络层明确禁止访问的域名。', en: 'Lists the domains that the managed network layer explicitly blocks.' },
      allow_upstream_proxy: { zhCN: '控制是否允许把上游代理接入到受管网络层。', en: 'Controls whether an upstream proxy may be used by the managed network layer.' },
      allow_local_binding: { zhCN: '控制受管网络层是否允许绑定本地监听地址。', en: 'Controls whether the managed network layer may bind local listening addresses.' },
      enable_socks5: { zhCN: '控制是否启用 SOCKS5 代理能力。', en: 'Controls whether SOCKS5 proxy support is enabled.' },
      enable_socks5_udp: { zhCN: '控制 SOCKS5 是否同时支持 UDP。', en: 'Controls whether SOCKS5 support also allows UDP traffic.' },
      dangerously_allow_non_loopback_proxy: { zhCN: '控制是否允许非 loopback 地址上的代理，这通常风险更高。', en: 'Controls whether proxies on non-loopback addresses are allowed, which is riskier.' },
      dangerously_allow_non_loopback_admin: { zhCN: '控制是否允许非 loopback 地址上的管理接口，这通常风险更高。', en: 'Controls whether admin endpoints on non-loopback addresses are allowed, which is riskier.' },
      dangerously_allow_all_unix_sockets: { zhCN: '控制是否放开所有 Unix socket，这通常风险更高。', en: 'Controls whether all Unix sockets are allowed, which is riskier.' },
      allow_unix_sockets: { zhCN: '列出在受管网络层里明确允许访问的 Unix socket。', en: 'Lists the Unix sockets that the managed network layer explicitly allows.' },
      proxy_url: { zhCN: '设置受管网络层使用的 HTTP 代理地址。', en: 'Sets the HTTP proxy URL used by the managed network layer.' },
      socks_url: { zhCN: '设置受管网络层使用的 SOCKS 代理地址。', en: 'Sets the SOCKS proxy URL used by the managed network layer.' },
      admin_url: { zhCN: '设置受管网络层管理接口的地址。', en: 'Sets the admin endpoint used to manage the network layer.' },
    };
    return labels[key] ?? {};
  }

  if (pathKey.startsWith('sandbox_workspace_write.')) {
    const key = pathKey.slice('sandbox_workspace_write.'.length);
    const labels: Record<string, { zhCN: string; en: string }> = {
      network_access: { zhCN: '控制 workspace-write 模式下是否允许外网访问。', en: 'Controls whether network access is allowed in workspace-write mode.' },
      writable_roots: { zhCN: '列出 workspace-write 模式下额外允许写入的目录。', en: 'Lists extra directories that remain writable in workspace-write mode.' },
      exclude_slash_tmp: { zhCN: '控制是否把 `/tmp` 从 workspace-write 的可写范围里排除。', en: 'Controls whether `/tmp` is excluded from workspace-write access.' },
      exclude_tmpdir_env_var: { zhCN: '控制是否把 `TMPDIR` 指向的目录从可写范围里排除。', en: 'Controls whether the directory named by `TMPDIR` is excluded from writable roots.' },
    };
    return labels[key] ?? {};
  }

  if (pathKey.startsWith('mcp_servers.')) {
    const field = pathKey.split('.').slice(-1)[0] ?? '';
    const labels: Record<string, { zhCN: string; en: string }> = {
      command: { zhCN: '设置启动这个 MCP 服务器时执行的命令。', en: 'Sets the command used to start this MCP server.' },
      args: { zhCN: '设置启动这个 MCP 服务器时传入的参数列表。', en: 'Sets the argument list used when this MCP server starts.' },
      cwd: { zhCN: '设置启动这个 MCP 服务器时使用的工作目录。', en: 'Sets the working directory used to launch this MCP server.' },
      enabled: { zhCN: '控制这个 MCP 服务器是否启用。', en: 'Controls whether this MCP server is enabled.' },
      required: { zhCN: '控制 Codex 是否把这个 MCP 服务器视为必需项。', en: 'Controls whether Codex treats this MCP server as required.' },
      startup_timeout_ms: { zhCN: '设置等待这个 MCP 服务器启动成功的最长毫秒数。', en: 'Sets how long Codex waits for this MCP server to start, in milliseconds.' },
      startup_timeout_sec: { zhCN: '设置等待这个 MCP 服务器启动成功的最长秒数。', en: 'Sets how long Codex waits for this MCP server to start, in seconds.' },
      tool_timeout_sec: { zhCN: '设置等待这个 MCP 服务器工具执行完成的最长秒数。', en: 'Sets how long Codex waits for tools from this MCP server to finish.' },
      enabled_tools: { zhCN: '列出这个 MCP 服务器允许暴露的工具。', en: 'Lists the tools this MCP server is explicitly allowed to expose.' },
      disabled_tools: { zhCN: '列出这个 MCP 服务器需要隐藏的工具。', en: 'Lists the tools this MCP server should hide.' },
      env: { zhCN: '设置启动这个 MCP 服务器时附带的环境变量。', en: 'Sets environment variables passed to this MCP server.' },
      url: { zhCN: '设置这个远程 MCP 服务器的访问地址。', en: 'Sets the URL used to reach this remote MCP server.' },
      bearer_token_env_var: { zhCN: '设置保存这个 MCP 服务器 token 的环境变量名。', en: 'Names the environment variable that stores this MCP server token.' },
      scopes: { zhCN: '列出这个 MCP 服务器请求的 OAuth scopes。', en: 'Lists the OAuth scopes requested for this MCP server.' },
      oauth_resource: { zhCN: '设置这个 MCP 服务器使用的 OAuth resource 地址。', en: 'Sets the OAuth resource URL used for this MCP server.' },
      http_headers: { zhCN: '设置访问这个 MCP 服务器时附带的固定 HTTP headers。', en: 'Sets fixed HTTP headers sent to this MCP server.' },
    };
    return labels[field] ?? {};
  }

  if (pathKey.startsWith('otel.')) {
    const field = pathKey.split('.').slice(-1)[0] ?? '';
    const labels: Record<string, { zhCN: string; en: string }> = {
      endpoint: { zhCN: '设置这个 OpenTelemetry exporter 上报数据的目标地址。', en: 'Sets the endpoint this OpenTelemetry exporter sends data to.' },
      protocol: { zhCN: '设置这个 OpenTelemetry exporter 使用的传输协议。', en: 'Sets the transport protocol used by this OpenTelemetry exporter.' },
      headers: { zhCN: '设置这个 OpenTelemetry exporter 附带的额外请求头。', en: 'Sets extra HTTP headers sent by this OpenTelemetry exporter.' },
      environment: { zhCN: '设置 OpenTelemetry 事件默认标记的环境名。', en: 'Sets the environment name attached to OpenTelemetry events.' },
      log_user_prompt: { zhCN: '控制是否把用户原始 prompt 记录到 OpenTelemetry。', en: 'Controls whether raw user prompts are included in OpenTelemetry logs.' },
    };
    return labels[field] ?? {};
  }

  if (pathKey === 'tools.web_search') {
    return {
      zhCN: '这是旧版 web_search 工具开关，通常应与顶层 web_search 配合使用。',
      en: 'This is the legacy web_search tool toggle and should usually match the top-level web_search setting.',
    };
  }

  if (pathKey === 'skills.config') {
    return {
      zhCN: '列出对单个 skill 的启用或禁用覆盖规则。',
      en: 'Lists per-skill enable and disable overrides.',
    };
  }

  const last = pathKey.split('.').slice(-1)[0] ?? pathKey;
  const genericByField: Record<string, { zhCN: string; en: string }> = {
    enabled: { zhCN: '控制这一项是否启用。', en: 'Controls whether this item is enabled.' },
    required: { zhCN: '控制这一项是否被视为必需。', en: 'Controls whether this item is treated as required.' },
    url: { zhCN: '设置这一项使用的 URL。', en: 'Sets the URL used by this setting.' },
    endpoint: { zhCN: '设置这一项使用的 endpoint。', en: 'Sets the endpoint used by this setting.' },
    headers: { zhCN: '设置这一项附带的请求头。', en: 'Sets the headers attached to this setting.' },
    command: { zhCN: '设置这一项执行的命令。', en: 'Sets the command used by this setting.' },
    args: { zhCN: '设置这一项使用的参数列表。', en: 'Sets the arguments used by this setting.' },
    cwd: { zhCN: '设置这一项使用的工作目录。', en: 'Sets the working directory used by this setting.' },
    path: { zhCN: '设置这一项使用的路径。', en: 'Sets the path used by this setting.' },
    env: { zhCN: '设置这一项附带的环境变量。', en: 'Sets the environment variables used by this setting.' },
  };
  return genericByField[last] ?? {};
}

function fallbackDescription(pathKey: string, language: 'zh-CN' | 'en'): string {
  const label = pathKey.split('.').slice(-1)[0] ?? pathKey;
  return language === 'zh-CN'
    ? `控制 ${label} 这一项的行为`
    : `Controls the behavior of ${label}`;
}

function cleanSentence(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

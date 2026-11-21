/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

/**
 * 系统更新(一键更新)后端逻辑
 *
 * 支持 three 种更新通道(按优先级):
 *  1. Watchtower HTTP API  —— Docker 部署,WATCHTOWER_API_URL(+TOKEN)
 *  2. Vercel Deploy Hook   —— VERCEL_DEPLOY_HOOK_URL
 *  3. Cloudflare Deploy Hook —— CF_PAGES_DEPLOY_HOOK_URL
 *  另:检测到 docker.sock 时可直接拉取镜像并重建容器(支持切换历史版本)
 *
 * 能力判断原则:平台硬指纹优先于用户声明的环境变量;
 * docker.sock 以真实调用 Engine API 验证,不以存在性为唯一依据。
 */

export type Platform = 'docker' | 'vercel' | 'cloudflare' | 'unknown';
export type UpdateChannel = 'watchtower' | 'vercel' | 'cloudflare' | 'docker';

export interface UpdateCapabilities {
  updateLatest: boolean;
  switchVersion: boolean;
  channel: UpdateChannel | null;
}

export interface UpdateCheckResult {
  platform: Platform;
  capabilities: UpdateCapabilities;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean | null;
  manualGuide?: string;
}

export interface VersionCommit {
  short: string;
  message: string;
  date: string;
}

export interface VersionEntry {
  sha: string;
  short: string;
  date: string;
  tag: string | null;
  isCurrent: boolean;
  isLatest: boolean;
  count: number;
  commits: VersionCommit[];
}

const GHCR_IMAGE = 'ghcr.io/lingxuxiaoyao/novatv';
const GHCR_REPO = 'lingxuxiaoyao/novatv';
const GITHUB_COMMITS_API =
  'https://api.github.com/repos/lingxuxiaoyao/NovaTV/commits?per_page=40';
const DOCKER_SOCK = '/var/run/docker.sock';
const CACHE_TTL = 10 * 60 * 1000;
const MAX_VERSION_NODES = 10;

interface CacheEntry<T> {
  data?: T;
  ts?: number;
}
const tagsCache: CacheEntry<string[]> = {};
const commitsCache: CacheEntry<any[]> = {};

// ---------- 平台检测(硬指纹优先) ----------

export function detectPlatform(): Platform {
  // Cloudflare Workers/Pages 运行时(平台自动存在,伪造不了)
  if (typeof (globalThis as any).WebSocketPair !== 'undefined') {
    return 'cloudflare';
  }
  if (
    typeof navigator !== 'undefined' &&
    (navigator as any).userAgent === 'Cloudflare-Workers'
  ) {
    return 'cloudflare';
  }
  // Vercel 平台自动注入
  if (process.env.VERCEL === '1') {
    return 'vercel';
  }
  // Node 运行时:结合 DOCKER_ENV 声明(仅作软信号)
  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    return process.env.DOCKER_ENV === 'true' ? 'docker' : 'unknown';
  }
  return 'unknown';
}

// ---------- Node 能力(遵循 config.ts 的 eval require 模式,保持 edge 兼容) ----------

function nodeModule<T>(id: string): T {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (eval('require') as NodeRequire)(id) as T;
}

interface SockResponse {
  status: number;
  text: string;
}

function sockRequest(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<SockResponse> {
  return new Promise((resolve, reject) => {
    try {
      const http = nodeModule<typeof import('http')>('http');
      const req = http.request(
        {
          socketPath: DOCKER_SOCK,
          path: opts.path,
          method: opts.method,
          headers: {
            Host: 'localhost',
            ...(opts.body
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(opts.body),
                }
              : {}),
            ...opts.headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode || 0, text }));
        }
      );
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/** docker.sock 实测可用性:文件存在 + 真实调通 Engine API */
export async function checkDockerSock(): Promise<boolean> {
  try {
    if (typeof process === 'undefined' || !(process as any).versions?.node) {
      return false;
    }
    const fs = nodeModule<typeof import('fs')>('fs');
    if (!fs.existsSync(DOCKER_SOCK)) return false;
    const res = await sockRequest({ method: 'GET', path: '/version' });
    return res.status === 200;
  } catch (e) {
    console.log('docker.sock 不可用:', (e as Error).message);
    return false;
  }
}

// ---------- 能力集 ----------

export async function getCapabilities(): Promise<UpdateCapabilities> {
  let channel: UpdateChannel | null = null;
  if (process.env.WATCHTOWER_API_URL) channel = 'watchtower';
  else if (process.env.VERCEL_DEPLOY_HOOK_URL) channel = 'vercel';
  else if (process.env.CF_PAGES_DEPLOY_HOOK_URL) channel = 'cloudflare';

  const sockOk = await checkDockerSock();
  if (!channel && sockOk) channel = 'docker';

  return {
    updateLatest: channel !== null,
    switchVersion: sockOk,
    channel,
  };
}

// ---------- 数据源:ghcr tags + GitHub commits ----------

async function fetchGhcrTags(): Promise<string[]> {
  const now = Date.now();
  if (tagsCache.data && now - (tagsCache.ts || 0) < CACHE_TTL) {
    return tagsCache.data;
  }
  const tokenUrl = `https://ghcr.io/token?scope=repository:${GHCR_REPO}:pull`;
  const headers: Record<string, string> = {};
  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    headers.Authorization =
      'Basic ' + Buffer.from(`x:${ghToken}`).toString('base64');
  }
  const tokenRes = await fetch(tokenUrl, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`ghcr token 获取失败: ${tokenRes.status}`);
  const { token } = (await tokenRes.json()) as { token: string };

  const listRes = await fetch(`https://ghcr.io/v2/${GHCR_REPO}/tags/list`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!listRes.ok) throw new Error(`ghcr tags 获取失败: ${listRes.status}`);
  const data = (await listRes.json()) as { tags?: string[] };
  const tags = data.tags || [];
  tagsCache.data = tags;
  tagsCache.ts = now;
  return tags;
}

async function fetchCommits(): Promise<any[]> {
  const now = Date.now();
  if (commitsCache.data && now - (commitsCache.ts || 0) < CACHE_TTL) {
    return commitsCache.data;
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'NovaTV-Update-Check',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(GITHUB_COMMITS_API, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub commits 获取失败: ${res.status}`);
  const list = (await res.json()) as any[];
  commitsCache.data = list;
  commitsCache.ts = now;
  return list;
}

/** 远程最新版本号(VERSION.txt,与 version.ts 同源同镜像) */
export async function fetchLatestVersion(): Promise<string | null> {
  const urls = [
    'https://ghfast.top/raw.githubusercontent.com/lingxuxiaoyao/NovaTV/main/VERSION.txt',
    'https://raw.githubusercontent.com/lingxuxiaoyao/NovaTV/main/VERSION.txt',
  ];
  // 两个地址并发请求:串行最坏要等 2×8s,出网受限时面板会长时间转圈。
  // 谁先返回合法版本号就用谁,另一个自动丢弃。
  const tasks = urls.map(async (url) => {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = (await res.text()).trim();
      if (!/^\d{14}$/.test(v)) throw new Error('版本号格式不合法');
      return v;
    } catch (e) {
      console.log('获取远程版本失败:', url, (e as Error).message);
      throw e;
    }
  });
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  }
}

/**
 * 把 YYYYMMDDHHMMSS 时间戳匹配到 commit。
 * 生成脚本用本地时间写入,而 GitHub API 给 UTC 时间,所以同时尝试
 * UTC 与 UTC+8 两种解读,取 ±10 分钟内命中的 commit。
 */
function matchCommitByVersion(
  commits: any[],
  version: string
): { sha: string; date: string } | null {
  // 防御性校验:版本号必须是 14 位数字字符串。
  // 若传入的是非字符串(例如模块被误标 'use client' 后服务端拿到的代理对象),
  // 直接返回 null,避免调用 .slice() 抛错导致整个接口 500。
  if (typeof version !== 'string' || !/^\d{14}$/.test(version)) return null;
  const s = version;
  const base = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(
    8,
    10
  )}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
  const candidates = [Date.parse(`${base}Z`)];
  try {
    const d = new Date(`${base}+08:00`);
    candidates.push(d.getTime());
  } catch {
    /* ignore */
  }
  const TOLERANCE = 10 * 60 * 1000;
  let best: { sha: string; date: string; diff: number } | null = null;
  for (const c of commits) {
    const t = Date.parse(c?.commit?.committer?.date || '');
    if (Number.isNaN(t)) continue;
    for (const cand of candidates) {
      if (Number.isNaN(cand)) continue;
      const diff = Math.abs(t - cand);
      if (diff <= TOLERANCE && (!best || diff < best.diff)) {
        best = { sha: c.sha, date: c.commit.committer.date, diff };
      }
    }
  }
  return best ? { sha: best.sha, date: best.date } : null;
}

/** 组装版本历史列表(最多 10 个有镜像 tag 的版本,聚合提交说明) */
export async function getVersionList(
  currentVersion: string
): Promise<VersionEntry[]> {
  // 镜像标签与提交列表任一拉取失败都不应让整个接口 500:
  // 服务器出网受限时至少还能把已知的版本 tag 列表展示出来。
  const [tagsRes, commitsRes] = await Promise.allSettled([
    fetchGhcrTags(),
    fetchCommits(),
  ]);
  if (tagsRes.status === 'rejected') {
    console.log('获取镜像标签失败:', (tagsRes.reason as Error)?.message);
  }
  if (commitsRes.status === 'rejected') {
    console.log('获取提交列表失败:', (commitsRes.reason as Error)?.message);
  }
  const tags = tagsRes.status === 'fulfilled' ? tagsRes.value : [];
  const commitList = commitsRes.status === 'fulfilled' ? commitsRes.value : [];
  if (tags.length === 0 || commitList.length === 0) return [];
  const tagSet = new Set(tags);
  const tagPrefix = 'sha-';

  const commits: (VersionCommit & { sha: string })[] = commitList
    .filter((c) => c?.sha && c?.commit?.committer?.date)
    .map((c) => ({
      sha: c.sha as string,
      short: (c.sha as string).slice(0, 7),
      message: String(c.commit.message || '').split('\n')[0],
      date: c.commit.committer.date as string,
    }));

  // 有镜像 tag 的版本节点(每次 push 的 head)
  const nodes = commits
    .filter((c) => tagSet.has(`${tagPrefix}${c.short}`))
    .slice(0, MAX_VERSION_NODES);

  // 当前运行版本匹配到 commit,再归到包含它的 tag 节点
  let currentSha: string | null = null;
  const matched = matchCommitByVersion(commitList, currentVersion);
  if (matched) {
    const short = matched.sha.slice(0, 7);
    if (tagSet.has(`${tagPrefix}${short}`)) {
      currentSha = matched.sha;
    } else {
      // 当前 commit 无独立 tag(批量推送的中段提交),归属其所在 push 的 head:
      // nodes 与 commits 都是「最新在前」,比它新的节点 index 更小,
      // 取其中 index 最大(离它最近)的那个才是这次 push 的 head。
      // 之前用 nodes.find 会直接命中全局最新的节点,归属错误。
      const idx = commits.findIndex((c) => c.sha === matched.sha);
      let host: (typeof nodes)[number] | null = null;
      for (const n of nodes) {
        const nIdx = commits.findIndex((c) => c.sha === n.sha);
        if (nIdx >= 0 && nIdx < idx) host = n;
      }
      currentSha = host ? host.sha : null;
    }
  }

  // 聚合每个版本节点相对上一节点的提交
  // 注意:GitHub commits API 返回顺序是「最新在前」,nodes 也按此顺序。
  // 因此 nodes[i] 的 idx 一定小于 nodes[i+1] 的 prevIdx,
  // 该版本包含的提交区间是 [idx, prevIdx)(含自身,不含上一个版本)。
  // 之前写成 slice(prevIdx + 1, idx + 1) 上下界颠倒,导致绝大多数版本显示 0 项更新。
  return nodes.map((node, i) => {
    const idx = commits.findIndex((c) => c.sha === node.sha);
    const prev = nodes[i + 1];
    const prevIdx = prev ? commits.findIndex((c) => c.sha === prev.sha) : -1;
    // 最旧的节点没有上一版本可比,取它自身及更早的全部提交
    const group = prev ? commits.slice(idx, prevIdx) : commits.slice(idx);
    return {
      sha: node.sha,
      short: node.short,
      date: node.date,
      tag: `${tagPrefix}${node.short}`,
      isCurrent: node.sha === currentSha,
      isLatest: i === 0,
      count: group.length,
      commits: group.map(({ short, message, date }) => ({
        short,
        message,
        date,
      })),
    };
  });
}

// ---------- 手动更新指引(按实测平台生成) ----------

export function manualGuide(platform: Platform): string {
  switch (platform) {
    case 'docker':
      return '手动更新命令:docker compose pull && docker compose up -d';
    case 'vercel':
      return '请到 Vercel 控制台手动 Redeploy,或配置 VERCEL_DEPLOY_HOOK_URL 启用一键更新';
    case 'cloudflare':
      return '请到 Cloudflare Pages 控制台重试部署,或配置 CF_PAGES_DEPLOY_HOOK_URL 启用一键更新';
    default:
      return '请手动拉取最新代码或镜像后重新构建部署';
  }
}

// ---------- 更新触发 ----------

export async function triggerUpdateLatest(): Promise<UpdateChannel> {
  const caps = await getCapabilities();
  if (!caps.channel || !caps.updateLatest) {
    throw new Error(manualGuide(detectPlatform()));
  }

  if (caps.channel === 'watchtower') {
    const url = process.env.WATCHTOWER_API_URL;
    if (!url) throw new Error('WATCHTOWER_API_URL 未配置');
    const headers: Record<string, string> = {};
    if (process.env.WATCHTOWER_API_TOKEN) {
      headers.Authorization = `Bearer ${process.env.WATCHTOWER_API_TOKEN}`;
    }
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/v1/update`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(90000), // 镜像拉取与解压耗时较长，放宽到 90 秒
      });
      if (!res.ok) {
        throw new Error(`Watchtower 更新请求失败: ${res.status}`);
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      // 若 Watchtower 已经在拉取并重启容器，可能导致连接超时或断开
      // 只要不是明确鉴权失败，超时或断连通常意味着更新正在后台执行中
      if (
        msg.includes('aborted') ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('fetch failed')
      ) {
        console.log('Watchtower 更新请求超时或连接重置(镜像正在拉取中):', msg);
        return 'watchtower';
      }
      throw e;
    }
    return 'watchtower';
  }

  if (caps.channel === 'vercel') {
    const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
    if (!hookUrl) throw new Error('VERCEL_DEPLOY_HOOK_URL 未配置');
    const res = await fetch(hookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Vercel Deploy Hook 触发失败: ${res.status}`);
    return 'vercel';
  }

  if (caps.channel === 'cloudflare') {
    const hookUrl = process.env.CF_PAGES_DEPLOY_HOOK_URL;
    if (!hookUrl) throw new Error('CF_PAGES_DEPLOY_HOOK_URL 未配置');
    const res = await fetch(hookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok)
      throw new Error(`Cloudflare Deploy Hook 触发失败: ${res.status}`);
    return 'cloudflare';
  }

  // docker 通道:无 Watchtower 时,直接通过 sock 拉 latest 并准备重建
  await prepareSwitchVersion('latest');
  return 'docker';
}

function shellQuote(v: string): string {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

/** 从自身容器 inspect 信息重建 docker run 参数(保持 compose 身份) */
function buildRunScript(inspect: any, tag: string): string {
  const name = String(inspect?.Name || '/novatv').replace(/^\//, '');
  const img = `${GHCR_IMAGE}:${tag}`;
  const flags: string[] = ['--name', shellQuote(name)];

  const policy = inspect?.HostConfig?.RestartPolicy?.Name;
  if (policy && policy !== 'no') flags.push('--restart', policy);

  const nm = inspect?.HostConfig?.NetworkMode;
  if (nm && nm !== 'default' && nm !== 'bridge') {
    flags.push('--network', shellQuote(nm));
  }

  const pb = inspect?.HostConfig?.PortBindings || {};
  for (const [port, binds] of Object.entries(pb)) {
    for (const b of binds as any[]) {
      const ip = b?.HostIp ? `${b.HostIp}:` : '';
      flags.push('-p', shellQuote(`${ip}${b.HostPort}:${port}`));
    }
  }

  for (const e of inspect?.Config?.Env || []) {
    if (!String(e).startsWith('HOSTNAME=')) flags.push('-e', shellQuote(e));
  }

  for (const b of inspect?.HostConfig?.Binds || []) {
    flags.push('-v', shellQuote(b));
  }

  // 保留 compose 身份标签,便于之后 compose 接管;丢弃一次性/陈旧标签
  const keepLabel = (k: string) =>
    [
      'com.docker.compose.project',
      'com.docker.compose.project.working_dir',
      'com.docker.compose.project.config_files',
      'com.docker.compose.service',
    ].some((p) => k === p || k.startsWith(`${p}.`));
  const labels = inspect?.Config?.Labels || {};
  for (const [k, v] of Object.entries(labels)) {
    if (keepLabel(k)) flags.push('--label', shellQuote(`${k}=${v}`));
  }

  return `docker stop ${shellQuote(name)} && docker rm ${shellQuote(
    name
  )} && docker run -d ${flags.join(' ')} ${shellQuote(img)}`;
}

async function dockerPull(image: string, tag: string): Promise<void> {
  const res = await sockRequest({
    method: 'POST',
    path: `/images/create?fromImage=${encodeURIComponent(
      image
    )}&tag=${encodeURIComponent(tag)}`,
  });
  if (res.status !== 200) {
    throw new Error(`拉取镜像失败(${res.status}): ${res.text.slice(0, 200)}`);
  }
  try {
    const last = JSON.parse(res.text.trim().split('\n').pop() || '{}');
    if (last.error) throw new Error(`拉取镜像失败: ${last.error}`);
  } catch (e) {
    if ((e as Error).message.includes('拉取镜像失败')) throw e;
  }
}

/**
 * 切换到指定版本(需 docker.sock):
 * 先拉取目标镜像与辅助镜像,创建一次性辅助容器负责停旧/删旧/启新,
 * 启动动作延迟到响应返回之后执行(应用自身会被替换)。
 */
export async function prepareSwitchVersion(
  tag: string
): Promise<{ helperId: string }> {
  if (!(await checkDockerSock())) {
    throw new Error('docker.sock 不可用,无法切换版本');
  }
  // 校验 tag 必须真实存在于 ghcr,防止任意镜像注入
  if (tag !== 'latest') {
    const tags = await fetchGhcrTags();
    if (!tags.includes(tag)) {
      throw new Error(`镜像 tag 不存在: ${tag}`);
    }
  }

  await dockerPull(GHCR_IMAGE, tag);
  await dockerPull('docker:cli', 'latest');

  const selfId = process.env.HOSTNAME || '';
  const inspectRes = await sockRequest({
    method: 'GET',
    path: `/containers/${encodeURIComponent(selfId)}/json`,
  });
  if (inspectRes.status !== 200) {
    throw new Error('无法获取自身容器信息,切换中止');
  }
  const inspect = JSON.parse(inspectRes.text);
  const script = buildRunScript(inspect, tag);

  const createRes = await sockRequest({
    method: 'POST',
    path: '/containers/create?name=novatv-switch-helper',
    body: JSON.stringify({
      Image: 'docker:cli',
      Cmd: ['sh', '-c', script],
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        AutoRemove: true,
      },
    }),
  });
  if (createRes.status !== 201) {
    throw new Error(
      `创建辅助容器失败(${createRes.status}): ${createRes.text.slice(0, 200)}`
    );
  }
  const { Id } = JSON.parse(createRes.text);
  return { helperId: Id };
}

/** 启动辅助容器(应在 HTTP 响应返回后再调用) */
export async function startHelper(helperId: string): Promise<void> {
  const res = await sockRequest({
    method: 'POST',
    path: `/containers/${helperId}/start`,
  });
  if (res.status !== 204 && res.status !== 200) {
    console.error('启动辅助容器失败:', res.status, res.text.slice(0, 200));
  }
}

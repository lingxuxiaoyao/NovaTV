/* eslint-disable @typescript-eslint/no-explicit-any, no-control-regex */
import { PanConfig } from './admin.types';

export interface PanItem {
  name: string;
  size: number;
  is_dir: boolean;
  modified?: string;
  path: string; // 相对网盘根目录的相对路径，例如 "/动漫/仙逆.mp4"
  raw_url?: string;
  thumb?: string;
}

export interface PanListResult {
  items: PanItem[];
  total: number;
  path: string; // 当前浏览的相对目录
}

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.m3u8',
  '.ts',
  '.flv',
  '.avi',
  '.wmv',
  '.iso',
]);

export function isVideoFile(filename: string): boolean {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filename.slice(dotIndex).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * 规范化并解析网盘路径，防止越权目录穿越（如 ../ 注入）
 * 返回：
 * - safe: 是否安全合规
 * - fullPath: 在 OpenList / AList 中的实际完整请求路径
 * - relativePath: 剔除 rootPath 后暴露给前端的相对路径（以 "/" 开头）
 */
export function resolvePanPath(
  rootPath: string,
  userPath?: string
): { safe: boolean; fullPath: string; relativePath: string } {
  // 1. 规范化 rootPath
  let cleanRoot = (rootPath || '/').trim().replace(/\\/g, '/');
  if (!cleanRoot.startsWith('/')) cleanRoot = '/' + cleanRoot;
  cleanRoot = cleanRoot.replace(/\/+/g, '/');
  if (cleanRoot.length > 1 && cleanRoot.endsWith('/')) {
    cleanRoot = cleanRoot.slice(0, -1);
  }

  // 2. 规范化 userPath，防御路径穿越与非法字符
  const rawSub = (userPath || '/').trim().replace(/\\/g, '/');
  const segments = rawSub.split('/').filter((s) => s && s !== '.');

  const safeSegments: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (safeSegments.length > 0) {
        safeSegments.pop();
      } else {
        // 尝试穿越到根目录之上，判定为非法
        return { safe: false, fullPath: cleanRoot, relativePath: '/' };
      }
    } else {
      if (/[\x00-\x1f\x7f]/.test(seg)) {
        return { safe: false, fullPath: cleanRoot, relativePath: '/' };
      }
      safeSegments.push(seg);
    }
  }

  const relativePath = '/' + safeSegments.join('/');
  let fullPath =
    cleanRoot === '/' ? relativePath : `${cleanRoot}${relativePath}`;
  fullPath = fullPath.replace(/\/+/g, '/');
  if (fullPath.length > 1 && fullPath.endsWith('/')) {
    fullPath = fullPath.slice(0, -1);
  }

  return { safe: true, fullPath, relativePath };
}

/**
 * 封装向 OpenList / AList 发起 HTTP 请求的客户端
 * 仅允许向管理员预先配置的 openlistUrl 发起请求
 */
async function openlistRequest<T>(
  baseUrl: string,
  endpoint: string,
  body: any,
  token?: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; code?: number; message?: string; data?: T }> {
  if (!baseUrl || !baseUrl.startsWith('http')) {
    return { ok: false, message: 'OpenList 服务地址未配置或格式不正确' };
  }

  const cleanBase = baseUrl.trim().replace(/\/+$/, '');
  const url = `${cleanBase}${
    endpoint.startsWith('/') ? endpoint : '/' + endpoint
  }`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token && token.trim()) {
    headers['Authorization'] = token.trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        ok: false,
        code: res.status,
        message: `OpenList 响应异常: ${res.status} ${res.statusText}`,
      };
    }

    const json = await res.json();
    if (json.code !== 200) {
      return {
        ok: false,
        code: json.code,
        message: json.message || 'OpenList 返回业务错误',
      };
    }

    return { ok: true, code: 200, message: json.message, data: json.data };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, message: '连接 OpenList 超时 (12秒)' };
    }
    return { ok: false, message: err.message || '连接 OpenList 失败' };
  }
}

/**
 * 测试与 OpenList 的连通性及根目录可读性
 */
export async function testOpenlistConnection(
  openlistUrl: string,
  token?: string,
  rootPath = '/'
): Promise<{ ok: boolean; message: string; rootItemsCount?: number }> {
  if (!openlistUrl) {
    return { ok: false, message: '请输入 OpenList / AList 接口地址' };
  }

  const { fullPath } = resolvePanPath(rootPath, '/');
  const res = await openlistRequest<{ content?: any[]; total?: number }>(
    openlistUrl,
    '/api/fs/list',
    { path: fullPath, password: '', page: 1, per_page: 10, refresh: false },
    token
  );

  if (!res.ok) {
    return {
      ok: false,
      message: res.message || '连接失败，请检查地址、Token 或根目录是否存在',
    };
  }

  const count = res.data?.content?.length || 0;
  return {
    ok: true,
    message: `连接成功！已连通 OpenList，根目录「${fullPath}」可读（包含 ${count} 项）`,
    rootItemsCount: count,
  };
}

/**
 * 列出指定目录下的文件夹与常见视频文件
 */
export async function listPanDirectory(
  config: PanConfig,
  userPath?: string
): Promise<{ ok: boolean; message?: string; result?: PanListResult }> {
  const { safe, fullPath, relativePath } = resolvePanPath(
    config.rootPath,
    userPath
  );
  if (!safe) {
    return { ok: false, message: '非法路径，禁止越权访问' };
  }

  const res = await openlistRequest<{ content?: any[]; total?: number }>(
    config.openlistUrl,
    '/api/fs/list',
    {
      path: fullPath,
      password: '',
      page: 1,
      per_page: 0,
      refresh: false,
    },
    config.openlistToken
  );

  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  const rawList = res.data?.content || [];
  const items: PanItem[] = [];

  for (const item of rawList) {
    if (item.is_dir || isVideoFile(item.name)) {
      const itemRelativePath = `${relativePath === '/' ? '' : relativePath}/${
        item.name
      }`;
      items.push({
        name: item.name,
        size: Number(item.size) || 0,
        is_dir: Boolean(item.is_dir),
        modified: item.modified,
        thumb: item.thumb,
        path: itemRelativePath,
      });
    }
  }

  items.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;
    return a.name.localeCompare(b.name, 'zh-CN', {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return {
    ok: true,
    result: {
      items,
      total: items.length,
      path: relativePath,
    },
  };
}

/**
 * 在网盘指定路径内搜索文件
 */
export async function searchPanFiles(
  config: PanConfig,
  keyword: string,
  userPath?: string
): Promise<{ ok: boolean; message?: string; result?: PanListResult }> {
  const { safe, fullPath, relativePath } = resolvePanPath(
    config.rootPath,
    userPath
  );
  if (!safe) {
    return { ok: false, message: '非法路径，禁止越权访问' };
  }

  const cleanKw = keyword.trim();
  if (!cleanKw) {
    return listPanDirectory(config, userPath);
  }

  const res = await openlistRequest<{ content?: any[]; total?: number }>(
    config.openlistUrl,
    '/api/fs/search',
    {
      parent: fullPath,
      keywords: cleanKw,
      page: 1,
      per_page: 100,
      scope: 0,
      password: '',
    },
    config.openlistToken
  );

  if (!res.ok) {
    // 降级策略：当 AList 未配置或未构建 search 索引时（返回 "search not available"），
    // 自动降级为当前目录及子目录的就地遍历过滤，保证搜索功能绝不中断
    const matchedItems: PanItem[] = [];
    const queue: string[] = [userPath || '/'];
    const visited = new Set<string>();
    let scannedCount = 0;

    while (queue.length > 0 && scannedCount < 15) {
      const curPath = queue.shift();
      if (!curPath || visited.has(curPath)) continue;
      visited.add(curPath);
      scannedCount++;

      const listRes = await listPanDirectory(config, curPath);
      if (!listRes.ok || !listRes.result) continue;

      for (const item of listRes.result.items) {
        if (item.name.toLowerCase().includes(cleanKw.toLowerCase())) {
          matchedItems.push(item);
        }
        if (item.is_dir && scannedCount < 12) {
          queue.push(item.path);
        }
      }
    }

    return {
      ok: true,
      result: {
        items: matchedItems,
        total: matchedItems.length,
        path: relativePath,
      },
    };
  }

  const rawList = res.data?.content || [];
  const items: PanItem[] = [];
  const cleanRoot = resolvePanPath(config.rootPath, '/').fullPath;

  for (const item of rawList) {
    if (item.is_dir || isVideoFile(item.name)) {
      const itemParent = (item.parent || '').replace(/\\/g, '/');
      let relParent = '';
      if (cleanRoot === '/') {
        relParent = itemParent;
      } else if (itemParent.startsWith(cleanRoot)) {
        relParent = itemParent.slice(cleanRoot.length);
      }
      if (!relParent.startsWith('/')) relParent = '/' + relParent;
      const itemRelativePath = `${relParent === '/' ? '' : relParent}/${
        item.name
      }`.replace(/\/+/g, '/');

      items.push({
        name: item.name,
        size: Number(item.size) || 0,
        is_dir: Boolean(item.is_dir),
        modified: item.modified,
        thumb: item.thumb,
        path: itemRelativePath,
      });
    }
  }

  return {
    ok: true,
    result: {
      items,
      total: items.length,
      path: relativePath,
    },
  };
}

export const PAN_PROVIDER_NAMES: Record<string, string> = {
  '139Yun': '中国移动云盘',
  '189Cloud': '天翼云盘',
  '189CloudPC': '天翼云盘',
  AliyundriveShare: '阿里云盘',
  AliyundriveShareOpen: '阿里云盘(Open)',
  AliyundriveOpen: '阿里云盘(Open)',
  BaiduNetdisk: '百度网盘',
  BaiduPhoto: '一刻相册',
  Quark: '夸克网盘',
  QuarkTV: '夸克网盘',
  '115 Cloud': '115网盘',
  '115 Share': '115分享',
  GoogleDrive: 'Google Drive',
  OneDrive: 'OneDrive',
  Lanzou: '蓝奏云',
  PikPak: 'PikPak',
  PikPakShare: 'PikPak',
  Local: '本地磁盘',
  WebDav: 'WebDAV',
  S3: 'S3对象存储',
};

export interface PanPlayDetail {
  name: string;
  size: number;
  raw_url: string;
  path: string;
  modified?: string;
  thumb?: string;
  provider: string;
  providerName: string;
  isDirect302: boolean;
  webProxy: boolean;
}

/**
 * 智能判定该流是否为真实 302 客户端直连
 */
export function detectIs302Direct(
  rawUrl: string,
  openlistUrl: string,
  provider?: string,
  webProxy?: boolean
): boolean {
  if (webProxy) return false;
  if (provider === 'Local') return false;

  try {
    const rawUrlObj = new URL(rawUrl);
    const openlistUrlObj = new URL(openlistUrl);

    // 如果域名/主机名与 AList 服务地址一致，且为 /d/ (下载代理) 或 /p/ (Web代理)，说明是 AList 代理中转
    if (
      rawUrlObj.hostname === openlistUrlObj.hostname &&
      (rawUrlObj.pathname.startsWith('/d/') ||
        rawUrlObj.pathname.startsWith('/p/'))
    ) {
      return false;
    }
  } catch {
    // URL 解析异常时安全兜底
  }

  return true;
}

/**
 * 获取单个视频文件的直链 (raw_url，走 302 客户端直连或 AList 代理)
 * 智能识别 302 客户端直连 与 AList 中转代理状态
 */
export async function getPanFileDirectUrl(
  config: PanConfig,
  userPath: string
): Promise<{
  ok: boolean;
  message?: string;
  data?: PanPlayDetail;
}> {
  const { safe, fullPath, relativePath } = resolvePanPath(
    config.rootPath,
    userPath
  );
  if (!safe) {
    return { ok: false, message: '非法路径，禁止越权访问' };
  }

  const res = await openlistRequest<{
    name: string;
    size: number;
    raw_url: string;
    modified?: string;
    thumb?: string;
    provider?: string;
    web_proxy?: boolean;
  }>(
    config.openlistUrl,
    '/api/fs/get',
    {
      path: fullPath,
      password: '',
    },
    config.openlistToken
  );

  if (!res.ok || !res.data?.raw_url) {
    return {
      ok: false,
      message: res.message || '获取直链失败，可能文件不存在或挂载异常',
    };
  }

  const rawUrl = res.data.raw_url || '';
  const provider = res.data.provider || '';
  const webProxy = Boolean(res.data.web_proxy);
  const isDirect302 = detectIs302Direct(
    rawUrl,
    config.openlistUrl,
    provider,
    webProxy
  );
  const providerName = PAN_PROVIDER_NAMES[provider] || provider || '私人网盘';

  return {
    ok: true,
    data: {
      name: res.data.name || relativePath.split('/').pop() || '',
      size: Number(res.data.size) || 0,
      raw_url: rawUrl,
      path: relativePath,
      modified: res.data.modified,
      thumb: res.data.thumb,
      provider,
      providerName,
      isDirect302,
      webProxy,
    },
  };
}

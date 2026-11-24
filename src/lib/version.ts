/* eslint-disable no-console */

// 注意：本文件同时被服务端(api/admin/update)和客户端(login/UserMenu)引用，
// 不能加 'use client'，否则服务端拿到的是 client reference 代理，
// 调用 .slice() 等属性方法会抛 "Attempted to call ... from the server" 错误。

const CURRENT_VERSION = '20261124121943';

// 版本检查结果枚举
export enum UpdateStatus {
  HAS_UPDATE = 'has_update', // 有新版本
  NO_UPDATE = 'no_update', // 无新版本
  FETCH_FAILED = 'fetch_failed', // 获取失败
}

// 远程版本检查URL配置（指向本项目自己的仓库，避免误报上游 MoonTV 的新版本）
const VERSION_CHECK_URLS = [
  'https://ghfast.top/raw.githubusercontent.com/lingxuxiaoyao/NovaTV/main/VERSION.txt',
  'https://raw.githubusercontent.com/lingxuxiaoyao/NovaTV/main/VERSION.txt',
];

// 浏览器端版本检查结果缓存：UserMenu 挂在 PageLayout 上，
// 每次页面跳转都会重新挂载并触发检查。不加缓存时每次跳转都要去
// GitHub 拉 VERSION.txt，国内网络下会挂起 5~10s，管理页因此显得很卡。
const UPDATE_CACHE_KEY = `novatv_update_check_${CURRENT_VERSION}`;
const UPDATE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时

function readUpdateCache(): UpdateStatus | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(UPDATE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; status: UpdateStatus };
    if (!cached || typeof cached.at !== 'number') return null;
    if (Date.now() - cached.at > UPDATE_CACHE_TTL) return null;
    if (
      cached.status !== UpdateStatus.HAS_UPDATE &&
      cached.status !== UpdateStatus.NO_UPDATE
    ) {
      return null;
    }
    return cached.status;
  } catch {
    return null;
  }
}

function writeUpdateCache(status: UpdateStatus) {
  try {
    if (typeof window === 'undefined') return;
    if (
      status !== UpdateStatus.HAS_UPDATE &&
      status !== UpdateStatus.NO_UPDATE
    ) {
      return;
    }
    window.localStorage.setItem(
      UPDATE_CACHE_KEY,
      JSON.stringify({ at: Date.now(), status })
    );
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/**
 * 检查是否有新版本可用
 * @returns Promise<UpdateStatus> - 返回版本检查状态
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  // 命中缓存直接返回，避免每次路由跳转都打外网
  const cached = readUpdateCache();
  if (cached) return cached;

  try {
    // 两个地址并发：串行最坏要等 2×5s，并发最坏只有 5s。
    // 任一地址拿到版本号即可结束；返回 null 的地址视为失败并继续等待另一个。
    const remoteVersion = await Promise.any(
      VERSION_CHECK_URLS.map(async (url) => {
        const v = await fetchVersionFromUrl(url);
        if (!v) throw new Error('empty version');
        return v;
      })
    ).catch(() => null);

    if (!remoteVersion) return UpdateStatus.FETCH_FAILED;

    const status = compareVersions(remoteVersion);
    writeUpdateCache(status);
    return status;
  } catch (error) {
    console.error('版本检查失败:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

/**
 * 从指定URL获取版本信息
 * @param url - 版本信息URL
 * @returns Promise<string | null> - 版本字符串或null
 */
async function fetchVersionFromUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const version = await response.text();
    return version.trim();
  } catch (error) {
    console.warn(`从 ${url} 获取版本信息失败:`, error);
    return null;
  }
}

/**
 * 比较版本号
 * @param remoteVersion - 远程版本号
 * @returns UpdateStatus - 返回版本比较结果
 */
function compareVersions(remoteVersion: string): UpdateStatus {
  try {
    // 将版本号转换为数字进行比较
    const current = parseInt(CURRENT_VERSION, 10);
    const remote = parseInt(remoteVersion, 10);

    return remote > current ? UpdateStatus.HAS_UPDATE : UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('版本比较失败:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

// 导出当前版本号供其他地方使用
export { CURRENT_VERSION };

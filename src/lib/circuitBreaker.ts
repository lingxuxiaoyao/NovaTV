/**
 * 视频源健康度与轻量级自适应熔断器
 *
 * 目标：
 * 1. 记录采集站的连续异常（超时、DNS失败、5xx等），达到阈值时短时间降权
 * 2. 冷却时间设为温和的 2 分钟，到期自动进入半开探测恢复
 * 3. 熔断降权的站点仅后置排队，绝不丢弃任何启用的源，确保全量聚合
 */

interface SiteHealthState {
  failures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  lastLatencyMs?: number;
}

const MAX_FAILURES = 3; // 连续 3 次失败触发降权
const COOLDOWN_DURATION_MS = 2 * 60 * 1000; // 温和冷却 2 分钟（到期自动恢复试探）
const MAX_MAP_ENTRIES = 500;

// 存储站点状态的轻量内存 Map
const siteHealthMap = new Map<string, SiteHealthState>();

/**
 * 记录站点请求成功
 */
export function recordSiteSuccess(key: string, latencyMs?: number): void {
  const current = siteHealthMap.get(key);
  if (current) {
    current.failures = 0;
    current.cooldownUntil = 0;
    if (typeof latencyMs === 'number') {
      current.lastLatencyMs = latencyMs;
    }
  } else {
    if (siteHealthMap.size >= MAX_MAP_ENTRIES) {
      siteHealthMap.clear();
    }
    siteHealthMap.set(key, {
      failures: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      lastLatencyMs: latencyMs,
    });
  }
}

/**
 * 记录站点请求失败（超时、网络断开、5xx 错误等）
 */
export function recordSiteFailure(key: string): void {
  const now = Date.now();
  const current = siteHealthMap.get(key);

  if (current) {
    current.failures += 1;
    current.lastFailureAt = now;
    if (current.failures >= MAX_FAILURES) {
      current.cooldownUntil = now + COOLDOWN_DURATION_MS;
    }
  } else {
    if (siteHealthMap.size >= MAX_MAP_ENTRIES) {
      siteHealthMap.clear();
    }
    siteHealthMap.set(key, {
      failures: 1,
      lastFailureAt: now,
      cooldownUntil: 0,
    });
  }
}

/**
 * 检查站点当前是否处于熔断冷却期
 */
export function isSiteDegraded(key: string): boolean {
  const state = siteHealthMap.get(key);
  if (!state || !state.cooldownUntil) {
    return false;
  }
  // 如果冷却时间已过，自动解除熔断状态（半开恢复）
  if (Date.now() >= state.cooldownUntil) {
    state.failures = 0;
    state.cooldownUntil = 0;
    return false;
  }
  return true;
}

/**
 * 按照站点健康状态排序：
 * - 健康站点排在最前享受先发网络并发
 * - 处于熔断冷却期的站点排在最后并发，确保 100% 覆盖全量源
 */
export function partitionSitesByHealth<T extends { key: string }>(
  sites: T[]
): {
  healthy: T[];
  degraded: T[];
} {
  const healthy: T[] = [];
  const degraded: T[] = [];

  for (const site of sites) {
    if (isSiteDegraded(site.key)) {
      degraded.push(site);
    } else {
      healthy.push(site);
    }
  }

  return { healthy, degraded };
}

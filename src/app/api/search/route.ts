import { NextResponse } from 'next/server';

import {
  partitionSitesByHealth,
  recordSiteFailure,
  recordSiteSuccess,
} from '@/lib/circuitBreaker';
import { ApiSite, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { isTitleRelevantToQuery } from '@/lib/searchFilter';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

// 动态并发通道数：维持 16 条高速跑道，哪个源先跑完立即由后续源顶上，兼顾吞吐量与防爆配额
const CONCURRENCY_LIMIT = 16;
// 单站点搜索硬超时 (毫秒)：缩短为 3.5s，快速阻断死源，防止慢源过度拖延总时间
const SITE_TIMEOUT_MS = 3500;

interface SiteSearchResult {
  siteKey: string;
  items: SearchResult[];
  latencyMs: number;
}

async function searchSiteWithTimeout(
  site: ApiSite,
  query: string
): Promise<SiteSearchResult> {
  const start = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), SITE_TIMEOUT_MS)
  );

  try {
    const items = await Promise.race([
      searchFromApi(site, query),
      timeoutPromise,
    ]);
    const latencyMs = Date.now() - start;
    recordSiteSuccess(site.key, latencyMs);
    return { siteKey: site.key, items: items || [], latencyMs };
  } catch {
    recordSiteFailure(site.key);
    return { siteKey: site.key, items: [], latencyMs: Infinity };
  }
}

/**
 * 轻量级动态流水线并发池（Worker Pool）
 * 保持活跃通道数恒定，随跑随补，杜绝串行批次等待
 */
async function runWithConcurrencyPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);

  try {
    // 1. 根据熔断状态将健康源排在前面优先抢跑道，异常降权源排在队尾但绝不丢弃
    const { healthy, degraded } = partitionSitesByHealth(apiSites);
    const candidateSites = [...healthy, ...degraded];

    // 2. 动态流水线并发池：保持 16 条活跃跑道，全量跑完 100% 的启用源
    const poolResults = await runWithConcurrencyPool(
      CONCURRENCY_LIMIT,
      candidateSites,
      (site) => searchSiteWithTimeout(site, query)
    );

    const collectedResults = poolResults.filter(
      (res): res is SiteSearchResult =>
        Boolean(res && res.items && res.items.length > 0)
    );

    // 3. 按各源实际响应延迟排序，快源结果靠前呈现
    collectedResults.sort((a, b) => a.latencyMs - b.latencyMs);

    let flattenedResults = collectedResults.flatMap((res) => res.items);

    // 4. 过滤与关键词无关的条目：部分站点无命中时会返回整页热门内容
    flattenedResults = flattenedResults.filter((result) =>
      isTitleRelevantToQuery(result.title, query)
    );

    // 5. 黄色敏感内容过滤
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}

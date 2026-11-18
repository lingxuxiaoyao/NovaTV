/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getConfig } from '@/lib/config';

export const runtime = 'edge';

interface ProbeResult {
  key: string;
  ok: boolean;
  ms: number | null;
  status?: number;
  count?: number;
  error?: string;
  errorText?: string;
}

const PROBE_TIMEOUT_MS = 5000;
const PROBE_CONCURRENCY = 4;

/** 把底层网络异常翻译成可读的原因 */
function describeError(err: any): string {
  const cause = err?.cause;
  const code: string | undefined = cause?.code || err?.code;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return '超时';
  switch (code) {
    case 'ENOTFOUND':
      return '域名解析失败';
    case 'ECONNREFUSED':
      return '连接被拒绝';
    case 'ECONNRESET':
      return '连接被重置';
    case 'ETIMEDOUT':
      return '连接超时';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return '网络不可达';
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return '证书错误';
    default:
      break;
  }
  const msg = cause?.message || err?.message || '未知错误';
  return msg.length > 60 ? `${msg.slice(0, 60)}…` : msg;
}

/** 探测单个源：发一次真实搜索请求，记录耗时与命中条数 */
async function probeSource(
  key: string,
  api: string,
  keyword: string
): Promise<ProbeResult> {
  const url = api + API_CONFIG.search.path + encodeURIComponent(keyword);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: API_CONFIG.search.headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    const ms = Date.now() - startedAt;

    if (!res.ok) {
      return {
        key,
        ok: false,
        ms,
        status: res.status,
        error: `HTTP ${res.status}`,
      };
    }

    let count = 0;
    try {
      const data = await res.json();
      count = Array.isArray(data?.list) ? data.list.length : 0;
    } catch {
      return {
        key,
        ok: false,
        ms,
        status: res.status,
        error: '返回内容不是合法 JSON',
      };
    }

    return { key, ok: true, ms, status: res.status, count };
  } catch (err: any) {
    return {
      key,
      ok: false,
      ms: null,
      error: describeError(err),
      errorText: err?.cause?.message || err?.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      keys?: string[];
      keyword?: string;
    };

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const keyword = (body.keyword || '').trim() || '爱情';
    const wantedKeys = Array.isArray(body.keys)
      ? body.keys.filter((k) => typeof k === 'string')
      : [];

    // 只探测启用中的源（禁用源没有实际流量，测了也没意义）
    const targets = adminConfig.SourceConfig.filter((s) => {
      if (s.disabled) return false;
      return wantedKeys.length === 0 || wantedKeys.includes(s.key);
    });

    if (targets.length === 0) {
      return NextResponse.json({ keyword, results: [] });
    }

    // 限制并发，避免一次打爆所有上游
    const results: ProbeResult[] = [];
    for (let i = 0; i < targets.length; i += PROBE_CONCURRENCY) {
      const batch = targets.slice(i, i + PROBE_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((s) => probeSource(s.key, s.api, keyword))
      );
      results.push(...batchResults);
    }

    return NextResponse.json(
      { keyword, results },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('视频源测速失败:', error);
    return NextResponse.json(
      {
        error: '视频源测速失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

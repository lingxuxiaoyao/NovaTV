/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  detectPlatform,
  fetchLatestVersion,
  getCapabilities,
  getVersionList,
  manualGuide,
  prepareSwitchVersion,
  startHelper,
  triggerUpdateLatest,
} from '@/lib/systemUpdate';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'edge';

function isOwner(request: NextRequest): boolean {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) return false;
  return authInfo.username === process.env.USERNAME;
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** 检查更新:返回能力集 + 版本比对 */
async function handleCheck(): Promise<NextResponse> {
  const platform = detectPlatform();
  const [capabilities, latestVersion] = await Promise.all([
    getCapabilities(),
    fetchLatestVersion(),
  ]);
  const result = {
    platform,
    capabilities,
    currentVersion: CURRENT_VERSION,
    latestVersion,
    hasUpdate: latestVersion ? latestVersion > CURRENT_VERSION : null,
    manualGuide: capabilities.updateLatest ? undefined : manualGuide(platform),
  };
  return NextResponse.json(result);
}

/** 版本历史(最多 10 个,含每个版本的更新内容) */
async function handleChangelog(): Promise<NextResponse> {
  const versions = await getVersionList(CURRENT_VERSION);
  return NextResponse.json({ versions });
}

export async function GET(request: NextRequest) {
  if (!isOwner(request)) return unauthorized();
  const action = request.nextUrl.searchParams.get('action') || 'check';
  try {
    if (action === 'check') return await handleCheck();
    if (action === 'changelog') return await handleChangelog();
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    console.error('系统更新检查失败:', e);
    return NextResponse.json(
      { error: (e as Error).message || '检查更新失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isOwner(request)) return unauthorized();
  try {
    const body = (await request.json()) as {
      action?: string;
      version?: string;
    };

    if (body.action === 'updateLatest') {
      const channel = await triggerUpdateLatest();
      return NextResponse.json({
        ok: true,
        channel,
        message:
          channel === 'docker'
            ? '新镜像拉取完成,容器即将重启'
            : '更新已触发,站点将短暂重启',
      });
    }

    if (body.action === 'updateVersion') {
      const tag = (body.version || '').trim();
      if (!/^sha-[0-9a-f]{7}$/.test(tag) && tag !== 'latest') {
        return NextResponse.json({ error: '非法版本号' }, { status: 400 });
      }
      const { helperId } = await prepareSwitchVersion(tag);
      const response = NextResponse.json({
        ok: true,
        message: `已拉取 ${tag},容器即将切换并重启`,
      });
      // 启动辅助容器要等响应返回之后(自身容器会被替换)
      setTimeout(() => {
        startHelper(helperId).catch((e) => console.error('切换版本失败:', e));
      }, 500);
      return response;
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    console.error('系统更新执行失败:', e);
    return NextResponse.json(
      { error: (e as Error).message || '更新失败' },
      { status: 500 }
    );
  }
}

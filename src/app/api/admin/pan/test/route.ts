/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, getDefaultPanConfig } from '@/lib/config';
import { testOpenlistConnection } from '@/lib/openlist';

export const runtime = 'edge';

function checkAdminRole(username?: string, config?: any): boolean {
  if (!username) return false;
  if (process.env.USERNAME && username === process.env.USERNAME) return true;
  const user = config?.UserConfig?.Users?.find(
    (u: any) => u.username === username
  );
  return user?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    const adminConfig = await getConfig();

    if (!checkAdminRole(authInfo?.username, adminConfig)) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { openlistUrl, openlistToken, rootPath } = body as {
      openlistUrl?: string;
      openlistToken?: string;
      rootPath?: string;
    };

    const currentPan = adminConfig.PanConfig || getDefaultPanConfig();

    let targetUrl = (openlistUrl || '').trim();
    if (!targetUrl) {
      targetUrl = currentPan.openlistUrl;
    }

    let targetToken =
      typeof openlistToken === 'string' ? openlistToken.trim() : '';
    if (!targetToken) {
      targetToken = currentPan.openlistToken || '';
    }

    let targetRoot = (rootPath || '').trim();
    if (!targetRoot) {
      targetRoot = currentPan.rootPath || '/';
    }

    if (!targetUrl) {
      return NextResponse.json(
        { ok: false, message: '请先填写 OpenList / AList 接口地址' },
        { status: 400 }
      );
    }

    const testRes = await testOpenlistConnection(
      targetUrl,
      targetToken,
      targetRoot
    );
    return NextResponse.json(testRes, { status: testRes.ok ? 200 : 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: err?.message || '测试连接异常' },
      { status: 500 }
    );
  }
}

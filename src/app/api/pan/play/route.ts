/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { checkUserPanPermission } from '@/lib/config';
import { getPanFileDirectUrl } from '@/lib/openlist';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json(
        { ok: false, error: '请先登录' },
        { status: 401 }
      );
    }

    const perm = await checkUserPanPermission(authInfo.username);
    if (!perm.enabled) {
      return NextResponse.json(
        { ok: false, error: '私人网盘影库功能未开启' },
        { status: 403 }
      );
    }
    if (!perm.allowed || !perm.config) {
      return NextResponse.json(
        { ok: false, error: '暂无私人网盘访问权限，请联系管理员开通' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');
    if (!filePath || !filePath.trim()) {
      return NextResponse.json(
        { ok: false, error: '缺少文件路径' },
        { status: 400 }
      );
    }

    const res = await getPanFileDirectUrl(perm.config, filePath.trim());
    if (!res.ok || !res.data) {
      return NextResponse.json(
        { ok: false, error: res.message || '获取直链失败' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: res.data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '服务器内部异常' },
      { status: 500 }
    );
  }
}

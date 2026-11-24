/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { checkUserPanPermission } from '@/lib/config';
import { listPanDirectory, searchPanFiles } from '@/lib/openlist';

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
    const subPath = searchParams.get('path') || '/';
    const keyword = searchParams.get('keyword') || '';

    if (keyword.trim()) {
      const res = await searchPanFiles(perm.config, keyword.trim(), subPath);
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.message || '搜索失败' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, data: res.result });
    }

    const res = await listPanDirectory(perm.config, subPath);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.message || '获取目录失败' },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, data: res.result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '服务器内部异常' },
      { status: 500 }
    );
  }
}

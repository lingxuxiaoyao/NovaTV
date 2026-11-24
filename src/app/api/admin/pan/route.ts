/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { PanConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, getDefaultPanConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

function checkAdminRole(username?: string, config?: any): boolean {
  if (!username) return false;
  if (process.env.USERNAME && username === process.env.USERNAME) return true;
  const user = config?.UserConfig?.Users?.find(
    (u: any) => u.username === username
  );
  return user?.role === 'admin';
}

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    const adminConfig = await getConfig();

    if (!checkAdminRole(authInfo?.username, adminConfig)) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const panConfig = adminConfig.PanConfig || getDefaultPanConfig();
    return NextResponse.json({
      ok: true,
      data: panConfig,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '获取网盘配置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { ok: false, error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

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
    const { enabled, openlistUrl, openlistToken, rootPath } = body as {
      enabled?: boolean;
      openlistUrl?: string;
      openlistToken?: string;
      rootPath?: string;
    };

    if (
      typeof enabled !== 'boolean' ||
      typeof openlistUrl !== 'string' ||
      typeof rootPath !== 'string'
    ) {
      return NextResponse.json(
        { ok: false, error: '参数格式错误' },
        { status: 400 }
      );
    }

    const currentPan = adminConfig.PanConfig || getDefaultPanConfig();

    // 如果前端未提供新 token（如留空或保持占位符），保留原有 Token
    let finalToken = currentPan.openlistToken || '';
    if (typeof openlistToken === 'string' && openlistToken.trim() !== '') {
      finalToken = openlistToken.trim();
    }

    const updatedPanConfig: PanConfig = {
      enabled,
      openlistUrl: openlistUrl.trim(),
      openlistToken: finalToken,
      rootPath: rootPath.trim() || '/',
    };

    adminConfig.PanConfig = updatedPanConfig;

    const storage = getStorage();
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    return NextResponse.json({
      ok: true,
      message: '网盘配置保存成功',
      data: updatedPanConfig,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '保存网盘配置失败' },
      { status: 500 }
    );
  }
}

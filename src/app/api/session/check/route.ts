/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getStorage } from '@/lib/db';

export const runtime = 'edge';

// 登录设备会话校验（供 middleware 内部调用）
// 返回该次登录的会话是否仍然有效（未被更新的设备挤出、未超过7天）
export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      // 本地存储模式无设备限制
      return NextResponse.json({ valid: true });
    }

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('u');
    const timestamp = Number(searchParams.get('t'));
    const deviceId = searchParams.get('d') || undefined;

    if (
      !username ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !deviceId
    ) {
      return NextResponse.json({ valid: false });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ valid: true });
    }

    const valid = await storage.hasUserSession(username, timestamp, deviceId);
    return NextResponse.json(
      { valid },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('会话校验失败:', err);
    // 校验服务异常时放行，避免存储故障导致全员无法访问
    return NextResponse.json({ valid: true });
  }
}

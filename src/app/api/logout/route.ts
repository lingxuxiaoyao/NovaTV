/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  // 1. 服务端会话作废：若配置了数据库（Redis/D1/Upstash），将该设备的时间戳置零，使其在服务端彻底失效
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (authInfo?.username && authInfo?.device_id) {
      const storage = getStorage();
      if (storage) {
        // 设置 session_time 为 0，使 hasUserSession 立即判定失效（timestampMs !== 0）
        await storage.saveUserSession(
          authInfo.username,
          0,
          authInfo.device_id,
          '已登出'
        );
      }
    }
  } catch (err) {
    console.error('服务端登出会话注销失败:', err);
  }

  const response = NextResponse.json({ ok: true });

  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');
  const isHttps = proto.split(',')[0].trim().toLowerCase() === 'https';

  // 2. 清除认证 cookie（兼容 HTTP 与 HTTPS/Secure 规范，带 maxAge: 0 强令浏览器立即擦除）
  response.cookies.delete('auth');
  response.cookies.set('auth', '', {
    path: '/',
    expires: new Date(0),
    maxAge: 0,
    sameSite: 'lax',
    httpOnly: false,
    secure: isHttps,
  });

  return response;
}

/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 如果没有设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      process.env.PASSWORD || ''
    );

    // 签名验证通过后，校验登录设备会话是否仍有效（设备上限按用户在管理后台的单独配置）
    if (isValidSignature && (await checkUserSession(request, authInfo))) {
      return NextResponse.next();
    }
  }

  // 签名验证失败或会话已失效
  return handleAuthFailure(request, pathname);
}

// 校验登录会话有效性：通过内部接口查询存储中的会话列表
// 设备上限按用户单独配置（device_limit，0 = 不限制），由校验接口读取配置后判定
// （middleware 无法直接访问 Redis/D1，故经由 API 路由查询）
async function checkUserSession(
  request: NextRequest,
  authInfo: { username?: string; timestamp?: number; device_id?: string }
): Promise<boolean> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') return true;

  try {
    const checkUrl = new URL('/api/session/check', request.url);
    if (authInfo.username) {
      checkUrl.searchParams.set('u', authInfo.username);
    }
    if (authInfo.timestamp) {
      checkUrl.searchParams.set('t', String(authInfo.timestamp));
    }
    if (authInfo.device_id) {
      checkUrl.searchParams.set('d', authInfo.device_id);
    }

    const res = await fetch(checkUrl, { method: 'GET' });
    if (!res.ok) return true; // 校验服务异常时放行，避免误伤

    const data = await res.json();
    return data?.valid !== false;
  } catch {
    // 内部请求失败时放行，避免网络抖动导致全员掉线
    return true;
  }
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/session', // 会话校验接口由 middleware 内部调用，必须跳过鉴权防止递归
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/session).*)',
  ],
};

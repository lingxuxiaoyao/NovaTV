/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { checkUserPanPermission } from '@/lib/config';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    const perm = await checkUserPanPermission(authInfo?.username);

    return NextResponse.json({
      enabled: perm.enabled,
      allowPan: perm.allowed,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        enabled: false,
        allowPan: false,
        error: err?.message || 'Internal error',
      },
      { status: 500 }
    );
  }
}

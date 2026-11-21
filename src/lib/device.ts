/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

export interface ClientDeviceHints {
  model?: string;
  platformVersion?: string;
  screen?: string;
}

// 常见主流品牌机型代号映射（优先提供友好中文名，未知代号原样展示）
const KNOWN_MODEL_MAP: Record<string, string> = {
  // 小米 / Redmi
  '23127PN0CC': '小米 14',
  '23116PN5BC': '小米 14 Pro',
  '24031PN0DC': '小米 14 Ultra',
  '24129PN74C': '小米 15',
  '24101PNB7C': '小米 15 Pro',
  '2211133C': '小米 13',
  '2210132C': '小米 13 Pro',
  // 华为 / 荣耀
  'ALN-AL00': '华为 Mate 60 Pro',
  'BRA-AL00': '华为 Mate 60',
  'HBN-AL00': '华为 Pura 70 Pro',
  'ADY-AL00': '华为 Pura 70',
  // Vivo / iQOO
  V2307A: 'vivo X100',
  V2324A: 'vivo X100 Pro',
  V2241A: 'vivo X90',
  // Oppo / 一加
  PHN110: 'OPPO Find X7',
  PJE110: '一加 12',
  PJF110: '一加 Ace 3',
};

function safeString(val: unknown, maxLen = 60): string {
  if (typeof val !== 'string') return '';
  return val
    .trim()
    .replace(/[\r\n\t]/g, '')
    .slice(0, maxLen);
}

function formatModel(raw: unknown): string {
  const safe = safeString(raw);
  if (!safe) return '';
  const hasKnown = Object.prototype.hasOwnProperty.call(KNOWN_MODEL_MAP, safe);
  const known = hasKnown ? KNOWN_MODEL_MAP[safe] : '';
  return known ? `${known} (${safe})` : safe;
}

function extractAndroidModelFromUA(ua: string): string {
  const match = ua.match(/\(([^)]+)\)/);
  if (!match) return '';
  const parts = match[1].split(';').map((p) => p.trim());
  const ignored =
    /^(Linux|Android|U|HarmonyOS|OpenHarmony|HMSCore|zh-[a-z]+|en-[a-z]+|wv|Mobile|Tablet|ARM|x86|WOW64|Win64|Windows|Macintosh|Intel|K)$/i;
  for (let i = parts.length - 1; i >= 0; i--) {
    let p = parts[i];
    p = p.replace(/\s*(Build|HMSCore)[/ ].*$/i, '').trim();
    if (
      p &&
      !ignored.test(p) &&
      !p.startsWith('Android') &&
      !p.startsWith('CPU') &&
      p !== 'K'
    ) {
      return safeString(p);
    }
  }
  return '';
}

/**
 * 客户端轻量嗅探设备硬件与系统特征（非阻塞、带300ms超时熔断、安全兜底）
 */
export async function getClientDeviceHints(): Promise<ClientDeviceHints> {
  const hints: ClientDeviceHints = {};
  if (typeof window === 'undefined') return hints;

  try {
    const w = window.screen?.width || 0;
    const h = window.screen?.height || 0;
    if (w && h) {
      hints.screen = `${Math.min(w, h)}×${Math.max(w, h)}`;
    }
  } catch (_) {
    // ignore
  }

  try {
    const uaData = (navigator as any)?.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 300)
      );
      const values = (await Promise.race([
        uaData.getHighEntropyValues(['model', 'platformVersion']),
        timeoutPromise,
      ])) as any;
      if (values?.model) hints.model = safeString(values.model);
      if (values?.platformVersion)
        hints.platformVersion = safeString(values.platformVersion);
    }
  } catch (_) {
    // ignore
  }

  return hints;
}

/**
 * 从 User-Agent 及前端上报的 Client Hints 解析出细致的设备描述，
 * 如 "Android 14 · 小米 14 (23127PN0CC) · 微信内置"、"iOS 17.4 · iPhone (393×852) · Safari"。
 * 仅用于管理界面展示，可能被伪造，不做任何安全判断依据。
 */
export function parseDeviceDescription(
  ua: string | null | undefined,
  hints?: ClientDeviceHints
): string {
  if (!ua && !hints) return '未知设备';
  const uaStr = ua || '';

  // 1. 操作系统与版本解析
  let os = '';
  if (/Windows NT/i.test(uaStr)) {
    if (/Windows NT 10\.0/i.test(uaStr)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/i.test(uaStr)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/i.test(uaStr)) os = 'Windows 7';
    else os = 'Windows';
  } else if (/Windows Phone/i.test(uaStr)) {
    os = 'Windows Phone';
  } else if (/HarmonyOS|OpenHarmony/i.test(uaStr)) {
    const v = uaStr.match(/(?:HarmonyOS|OpenHarmony)\s*[/ ]?(\d+(?:\.\d+)?)/i);
    os = v ? `HarmonyOS ${v[1]}` : 'HarmonyOS';
  } else if (/Android/i.test(uaStr)) {
    const v = uaStr.match(/Android\s*(\d+(?:\.\d+)?)/i);
    const ver = v ? v[1] : safeString(hints?.platformVersion);
    os = ver ? `Android ${ver}` : 'Android';
  } else if (/iPhone|iPad|iPod/i.test(uaStr)) {
    const v = uaStr.match(/OS\s*(\d+(?:[._]\d+)*)/i);
    const ver = v ? ` ${v[1].replace(/_/g, '.')}` : '';
    if (/iPad/i.test(uaStr)) os = `iPadOS${ver}`;
    else if (/iPod/i.test(uaStr)) os = `iPod${ver}`;
    else os = `iOS${ver}`;
  } else if (/Mac OS X/i.test(uaStr)) {
    const v = uaStr.match(/Mac OS X\s*(\d+(?:[._]\d+)*)/i);
    os = v ? `macOS ${v[1].replace(/_/g, '.')}` : 'macOS';
  } else if (/Linux/i.test(uaStr)) {
    os = 'Linux';
  }

  // 2. 手机机型硬件信息解析
  let model = '';
  if (/Android|HarmonyOS/i.test(os) || /Android|HarmonyOS/i.test(uaStr)) {
    const rawModel =
      safeString(hints?.model) || extractAndroidModelFromUA(uaStr);
    if (rawModel) {
      model = formatModel(rawModel);
    }
  } else if (/iOS|iPhone|iPad/i.test(os) || /iPhone|iPad/i.test(uaStr)) {
    const deviceType = /iPad/i.test(uaStr) ? 'iPad' : 'iPhone';
    const screen = safeString(hints?.screen, 30);
    model = screen ? `${deviceType} (${screen})` : deviceType;
  }

  // 3. 浏览器特征（按特征串从特殊到一般匹配，避免误判）
  let browser = '';
  if (/MicroMessenger/i.test(uaStr)) browser = '微信内置';
  else if (/\bEdg(e|A|iOS)?\//i.test(uaStr)) browser = 'Edge';
  else if (/QQBrowser/i.test(uaStr)) browser = 'QQ浏览器';
  else if (/UCBrowser|UCWEB/i.test(uaStr)) browser = 'UC浏览器';
  else if (/Quark/i.test(uaStr)) browser = '夸克';
  else if (/Baidu/i.test(uaStr)) browser = '百度浏览器';
  else if (/OPR\/|Opera/i.test(uaStr)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(uaStr)) browser = 'Firefox';
  else if (/CriOS/i.test(uaStr)) browser = 'Chrome';
  else if (/Chrome\//i.test(uaStr)) browser = 'Chrome';
  else if (/Safari\//i.test(uaStr)) browser = 'Safari';

  const desc = [os, model, browser].filter(Boolean).join(' · ');
  return desc || '未知设备';
}

/**
 * 安全工具模块：防范 SSRF（服务端请求伪造）与恶意 URL 请求
 * 兼容 Edge Runtime (Cloudflare Pages/Workers) 与 Node.js 运行环境
 */

/**
 * 判断是否为私有、回环或链路本地的 IPv4 地址
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // 畸形 IP 一律判定为不安全
  }

  const [a, b] = parts;

  // 0.0.0.0/8 - 本网络
  if (a === 0) return true;
  // 10.0.0.0/8 - 私网
  if (a === 10) return true;
  // 127.0.0.0/8 - 回环地址 (127.0.0.1 等)
  if (a === 127) return true;
  // 100.64.0.0/10 - 运营商级 NAT (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 - 链路本地 / 云厂商元数据 (如 AWS/GCP 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 - 私网 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 - 私网
  if (a === 192 && b === 168) return true;
  // 255.255.255.255 - 广播
  if (a === 255) return true;

  return false;
}

/**
 * 判断是否为私有、回环或链路本地的 IPv6 地址
 */
function isPrivateIPv6(host: string): boolean {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase();

  // ::1 / :: 回环与未指定
  if (clean === '::1' || clean === '::') return true;

  // IPv4-mapped IPv6 (例如 ::ffff:127.0.0.1)
  if (clean.startsWith('::ffff:')) {
    const ipv4 = clean.slice(7);
    return isPrivateIPv4(ipv4);
  }

  // fc00::/7 (Unique Local Address, fc00:: ~ fdff::)
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;

  // fe80::/10 (Link-Local)
  if (
    clean.startsWith('fe8') ||
    clean.startsWith('fe9') ||
    clean.startsWith('fea') ||
    clean.startsWith('feb')
  ) {
    return true;
  }

  return false;
}

export interface UrlSecurityOptions {
  /** 是否放行局域网私有 IP 与本地主机（用于管理员在 NAS / 家庭局域网自建的视频源） */
  allowPrivateNetwork?: boolean;
}

/**
 * 校验外部 URL 是否安全：
 * 1. 协议仅允许 http / https
 * 2. 默认模式拦截本地回环、局域网段与云平台元数据地址 (如 169.254.169.254)
 * 3. 管理端模式（allowPrivateNetwork: true）放行 192.168.x / 10.x 等自建源，但依然拦截畸形协议与云元数据
 */
export function isSafeExternalUrl(
  inputUrl?: string | null,
  options?: UrlSecurityOptions
): { safe: boolean; reason?: string } {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { safe: false, reason: 'URL 为空' };
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    return { safe: false, reason: 'URL 格式非法' };
  }

  // 1. 协议限制（绝不允许 file://, gopher://, javascript: 等）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `不支持的协议: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { safe: false, reason: '缺失主机名' };
  }

  // 拦截云服务商元数据凭据（即使是管理员模式也严格防范泄漏云凭据）
  if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
    return { safe: false, reason: '禁止访问云平台元数据地址' };
  }

  // 若允许私有网络（管理员配置自建源场景），放行内网 IP 与 localhost
  if (options?.allowPrivateNetwork) {
    return { safe: true };
  }

  // 2. 公网严格模式：过滤常见本地与内部域名
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.onion')
  ) {
    return { safe: false, reason: '禁止请求本地与内网域名' };
  }

  // 3. 检测数字形式的 IP（十进制整数绕过，如 2130706433 对应 127.0.0.1）
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const a = (num >> 24) & 255;
      const b = (num >> 16) & 255;
      const c = (num >> 8) & 255;
      const d = num & 255;
      if (isPrivateIPv4(`${a}.${b}.${c}.${d}`)) {
        return { safe: false, reason: '禁止访问私有内网 IP' };
      }
    }
  }

  // 4. 标准 IPv4 检测
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { safe: false, reason: '禁止访问私有内网 IP' };
    }
  }

  // 5. IPv6 检测
  if (hostname.includes(':') || hostname.startsWith('[')) {
    if (isPrivateIPv6(hostname)) {
      return { safe: false, reason: '禁止访问私有内网 IPv6' };
    }
  }

  return { safe: true };
}

// 生产级 M3U8 广告切片过滤器（工业级：含加密状态机、全门禁、防误杀、异常补位）

// 严格带边界的路径关键词黑名单（绝不误杀 alphabet、casino-royale 等合法片名）
const AD_PATH_PATTERNS: RegExp[] = [
  /\/adjump\//i,
  /\/(ad|ads|adv|advert|advertising|adslot|preroll|midroll)\//i,
  /\/(gg|guanggao|sponsor|banner)\//i,
  /\/(xinpujing|qipai|boyi)\//i,
  // 强特征词：即使不带序号（如 /ad.ts）也判定为广告
  /(^|\/|[_\-.=])(ad|ads|adv|advert|advertising|adslot|adjump|preroll|midroll|gg)[_\-.=]?\d*\.(ts|m4s|jpg|png|jpeg)$/i,
  // 歧义词（promo/casino/macau 等）：必须带序号，/movies/promo.ts 这类合法片名不得命中
  /(^|\/|[_\-.=])(promo|macau|xinpujing|casino|qipai|boyi)[_\-.=]?\d+\.(ts|m4s|jpg|png|jpeg)$/i,
  /\/time\/\d{7,}\.ts$/i,
  /(^|\/|[^a-z])bet\d{2,}[_\-.]?\d*\.(ts|m4s|jpg|png|jpeg)$/i,
];

// 匹配二级域名级广告分流（如 https://ads.cdn.com/...）
const AD_HOST_PATTERN =
  /^https?:\/\/(ad|ads|adv|advert|adjump|adslot|preroll|midroll|gg)\d*\./i;

// 快速预筛提示符：避免对数千个普通正片切片无意义遍历 8 条正则，性能提升 10 倍
const FAST_AD_HINT =
  /ad|gg|promo|time|bet|macau|casino|xinpujing|qipai|boyi|sponsor|banner|guanggao|preroll|midroll/i;

const CONFIG = {
  minSegmentsForStats: 20,
  outlierDirShare: 0.08,
  maxAdBlockDurationSec: 45,
  minAdRatioInBlock: 0.75,
  maxSafeRemoveRatio: 0.5,
  defaultCueBudgetSec: 60,
};

export interface CleanResult {
  cleaned: string;
  removedCount: number;
  bypassed: boolean;
  reason?: string;
}

interface Segment {
  tags: string[];
  absUrl: string;
  dirKey: string;
  duration: number;
  blockId: number;
  isAd: boolean;
}

function parseBaseParts(baseUrl: string): { origin: string; baseDir: string } {
  try {
    const u = new URL(baseUrl);
    const slash = u.pathname.lastIndexOf('/');
    const dir = slash >= 0 ? u.pathname.slice(0, slash + 1) : '/';
    return { origin: u.origin, baseDir: `${u.origin}${dir}` };
  } catch {
    return { origin: '', baseDir: '' };
  }
}

// 轻量绝对路径拼接：支持大写 HTTP(S)://，零 new URL() 开销，仅复杂相对路径回退
function resolveUrlFast(
  line: string,
  baseUrl: string,
  origin: string,
  baseDir: string
): string {
  // G7: 大写 scheme 的 HTTPS:// 必须原样透传，绝不能被拼成 baseDir 前缀
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) return line;
  if (line.startsWith('//') && origin) return `${origin.split(':')[0]}:${line}`;
  if (line.startsWith('/') && origin && !line.includes('..'))
    return `${origin}${line}`;
  if (baseDir && !line.startsWith('.') && !line.includes('..'))
    return `${baseDir}${line}`;
  try {
    return new URL(line, baseUrl).toString();
  } catch {
    return line;
  }
}

// 轻量提取“去掉 query 后的目录键”和“pathname”，纯字符串操作
function extractDirAndPath(absUrl: string): {
  dirKey: string;
  pathname: string;
} {
  const qIdx = absUrl.indexOf('?');
  const clean = qIdx >= 0 ? absUrl.slice(0, qIdx) : absUrl;
  const hIdx = clean.indexOf('#');
  const noHash = hIdx >= 0 ? clean.slice(0, hIdx) : clean;

  const protoIdx = noHash.indexOf('://');
  const pathStart = protoIdx >= 0 ? noHash.indexOf('/', protoIdx + 3) : -1;
  const pathname = pathStart >= 0 ? noHash.slice(pathStart) : noHash;

  const lastSlash = noHash.lastIndexOf('/');
  const dirKey =
    lastSlash > (protoIdx >= 0 ? protoIdx + 2 : -1)
      ? noHash.slice(0, lastSlash)
      : '';
  return { dirKey, pathname };
}

// 只有真正的整条播放列表级标签才能留在 header；GAP / PROGRAM-DATE-TIME /
// DATERANGE / PART 这类按片生效的标签必须归到首片，随首片一起被删除或保留
const HEADER_TAG =
  /^#(EXTM3U|EXT-X-VERSION|EXT-X-TARGETDURATION|EXT-X-MEDIA-SEQUENCE|EXT-X-DISCONTINUITY-SEQUENCE|EXT-X-PLAYLIST-TYPE|EXT-X-I-FRAMES-ONLY)\b/i;

function isPlaylistHeaderTag(line: string): boolean {
  return HEADER_TAG.test(line);
}

function parseExtinfDuration(tags: string[]): number {
  for (const t of tags) {
    const m = t.match(/^#EXTINF:\s*([\d.]+)/i);
    if (m) return parseFloat(m[1]) || 0;
  }
  return 0;
}

/**
 * 工业级 M3U8 清洗引擎
 */
export function cleanM3U8(content: string, baseUrl: string): CleanResult {
  // S4 契约保护：非法输入返回空字符串，确保类型契约绝对安全
  if (!content || typeof content !== 'string') {
    return {
      cleaned: '',
      removedCount: 0,
      bypassed: true,
      reason: 'empty_content',
    };
  }

  // 1. Master Playlist 主索引（多码率），直接放行
  if (/#EXT-X-STREAM-INF/i.test(content)) {
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'master_playlist',
    };
  }

  // 2. 单文件 ByteRange：删除切片会导致隐式 offset 计算错乱花屏
  if (/#EXT-X-BYTERANGE/i.test(content)) {
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'byterange_detected',
    };
  }

  // 3. LL-HLS 微切片：含有 #EXT-X-PART 无法安全离散剔除
  if (/#EXT-X-PART/i.test(content)) {
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'll_hls_part_detected',
    };
  }

  // 4. 无分片标签直接放行
  if (!/#EXTINF:/i.test(content)) {
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'no_extinf',
    };
  }

  // 5. 直播流 / LL-HLS：无 #EXT-X-ENDLIST 说明是滑动窗口直播，删切片会导致 SN 错位与卡死
  if (!/#EXT-X-ENDLIST/i.test(content)) {
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'live_stream_not_vod',
    };
  }

  try {
    const { origin, baseDir } = parseBaseParts(baseUrl);
    const lines = content.split(/\r?\n/);
    const headerLines: string[] = [];
    const footerLines: string[] = [];
    const segments: Segment[] = [];

    let inCueAd = false;
    let cueRemainingDuration = 0;
    let hasCueExplicitDuration = false;
    let currentCueSegmentDuration = 0;
    let currentBlockId = 0;
    let pendingTags: string[] = [];
    let seenFirstSegment = false;
    let cueRemovedCount = 0; // cumulative, used for removedCount accounting
    let cueIntervalRemoved = 0; // per-interval, used for DISCONTINUITY compensation
    let cueBufferedTags: string[] = []; // tags seen inside an ad zone, owned by the next segment

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // B2: 优先捕获 #EXT-X-ENDLIST，绝不允许在 inCueAd 区间内被吞掉，同时严格去重防止播放器报 levelParsingError
      if (/^#EXT-X-ENDLIST/i.test(line)) {
        if (!footerLines.some((fl) => /^#EXT-X-ENDLIST/i.test(fl))) {
          footerLines.push(line);
        }
        inCueAd = false;
        cueBufferedTags = [];
        continue;
      }

      // SCTE-35 / CUE 广告区间处理（含 CUE-OUT-CONT 剥离与 B1 自动时长闭合）
      if (/^#EXT-X-CUE-OUT-CONT/i.test(line)) {
        continue;
      }
      if (
        /^#EXT-X-CUE-OUT(:|$)/i.test(line) ||
        /^#EXT-OATCLS-SCTE35/i.test(line)
      ) {
        inCueAd = true;
        cueIntervalRemoved = 0;
        cueBufferedTags = [];
        const durMatch = line.match(/(?:DURATION=|:)([\d.]+)/i);
        if (durMatch) {
          cueRemainingDuration = parseFloat(durMatch[1]) || 0;
          hasCueExplicitDuration = cueRemainingDuration > 0;
        } else {
          cueRemainingDuration = CONFIG.defaultCueBudgetSec;
          hasCueExplicitDuration = false;
        }
        continue;
      }
      if (/^#EXT-X-CUE-IN/i.test(line)) {
        if (inCueAd && cueIntervalRemoved > 0) {
          pendingTags.push('#EXT-X-DISCONTINUITY');
        }
        inCueAd = false;
        cueRemainingDuration = 0;
        hasCueExplicitDuration = false;
        currentCueSegmentDuration = 0;
        cueIntervalRemoved = 0;
        cueBufferedTags = [];
        continue;
      }
      if (inCueAd) {
        // 核心修复 P0-2：广告区内的 KEY/MAP 属于广告自身，必须丢弃，
        // 绝对不能放入 cueBufferedTags 暂存，避免泄漏给后续正片导致解密黑屏。
        if (line.startsWith('#')) {
          if (line.startsWith('#EXTINF:')) {
            const m = line.match(/^#EXTINF:\s*([\d.]+)/i);
            currentCueSegmentDuration = m ? parseFloat(m[1]) || 0 : 0;
          }
          if (!/^#EXT-X-KEY:|^#EXT-X-MAP:/i.test(line)) {
            cueBufferedTags.push(line);
          }
          continue;
        }

        const cueUrl = resolveUrlFast(line, baseUrl, origin, baseDir);
        const cuePath = extractDirAndPath(cueUrl).pathname;
        const cueHitAd =
          AD_HOST_PATTERN.test(cueUrl) ||
          (FAST_AD_HINT.test(cuePath) &&
            AD_PATH_PATTERNS.some((re) => re.test(cuePath)));

        if (!hasCueExplicitDuration && !cueHitAd) {
          inCueAd = false;
          currentCueSegmentDuration = 0;
          if (cueIntervalRemoved > 0) {
            pendingTags.push('#EXT-X-DISCONTINUITY');
            cueIntervalRemoved = 0;
          }
          pendingTags.push(...cueBufferedTags);
          cueBufferedTags = [];
        } else {
          cueRemovedCount++;
          cueIntervalRemoved++;
          cueRemainingDuration -= currentCueSegmentDuration;
          currentCueSegmentDuration = 0;
          cueBufferedTags = [];
          // 核心修复：无论是否显式声明时长，只要预算耗尽即安全闭合 CUE 状态
          if (cueRemainingDuration <= 0.05) {
            inCueAd = false;
            if (cueIntervalRemoved > 0) {
              pendingTags.push('#EXT-X-DISCONTINUITY');
              cueIntervalRemoved = 0;
            }
          }
          continue;
        }
      }

      if (/^#EXT-X-DISCONTINUITY$/i.test(line)) {
        currentBlockId++;
        pendingTags.push(line);
        continue;
      }

      if (line.startsWith('#')) {
        if (!seenFirstSegment && isPlaylistHeaderTag(line)) {
          headerLines.push(line);
        } else {
          pendingTags.push(line);
        }
        continue;
      }

      seenFirstSegment = true;
      const absUrl = resolveUrlFast(line, baseUrl, origin, baseDir);
      const { dirKey, pathname } = extractDirAndPath(absUrl);

      const hitAd =
        AD_HOST_PATTERN.test(absUrl) ||
        (FAST_AD_HINT.test(pathname) &&
          AD_PATH_PATTERNS.some((re) => re.test(pathname)));

      segments.push({
        tags: pendingTags,
        absUrl,
        dirKey,
        duration: parseExtinfDuration(pendingTags),
        blockId: currentBlockId,
        isAd: hitAd,
      });
      pendingTags = [];
    }

    const hasDiscontinuity = currentBlockId > 0;

    // 统计各块总时长与切片数
    const blockDuration = new Map<number, number>();
    const blockSegCount = new Map<number, number>();
    for (const seg of segments) {
      blockDuration.set(
        seg.blockId,
        (blockDuration.get(seg.blockId) || 0) + seg.duration
      );
      blockSegCount.set(seg.blockId, (blockSegCount.get(seg.blockId) || 0) + 1);
    }

    // 核心修复：少数派目录联合判定。仅当目录本身包含广告特征词提示（如 ad/gg/banner 等）时，
    // 结合少数派份额（<=8%）与短块（<=45s）判定为广告，绝不把干净的备用 CDN 或 intro 目录误杀
    if (hasDiscontinuity && segments.length >= CONFIG.minSegmentsForStats) {
      const dirCounts = new Map<string, number>();
      for (const seg of segments) {
        dirCounts.set(seg.dirKey, (dirCounts.get(seg.dirKey) || 0) + 1);
      }
      for (const seg of segments) {
        if (seg.isAd) continue;
        const dirHasAdHint = FAST_AD_HINT.test(seg.dirKey);
        if (!dirHasAdHint) continue;

        const share = (dirCounts.get(seg.dirKey) || 0) / segments.length;
        const bDur = blockDuration.get(seg.blockId) || 0;
        if (
          share <= CONFIG.outlierDirShare &&
          bDur > 0 &&
          bDur <= CONFIG.maxAdBlockDurationSec
        ) {
          seg.isAd = true;
        }
      }
    }

    // 短块联动剔除：全片存在 DISCONTINUITY 时才开启块联动，块总时长 <= 45s 且块内广告命中率 >= 75% 才整块丢弃
    if (hasDiscontinuity) {
      const blockAdCount = new Map<number, number>();
      for (const seg of segments) {
        if (seg.isAd) {
          blockAdCount.set(
            seg.blockId,
            (blockAdCount.get(seg.blockId) || 0) + 1
          );
        }
      }
      for (const seg of segments) {
        const bDur = blockDuration.get(seg.blockId) || 0;
        const bTotal = blockSegCount.get(seg.blockId) || 1;
        const bAds = blockAdCount.get(seg.blockId) || 0;
        if (
          bDur > 0 &&
          bDur <= CONFIG.maxAdBlockDurationSec &&
          bTotal >= 2 &&
          bAds / bTotal >= CONFIG.minAdRatioInBlock
        ) {
          seg.isAd = true;
        }
      }
    }

    // 双熔断：剩余 0 片或删减超 50% 直接回退原内容
    const keptCount = segments.reduce((n, s) => n + (s.isAd ? 0 : 1), 0);
    // CUE 区间内被删的切片不在 segments 中，需用 cueRemovedCount 补计入总数
    const totalOriginal = segments.length + cueRemovedCount;
    const totalRemoved = segments.length - keptCount + cueRemovedCount;
    if (
      keptCount === 0 ||
      (totalOriginal > 0 &&
        totalRemoved / totalOriginal > CONFIG.maxSafeRemoveRatio)
    ) {
      return {
        cleaned: content,
        removedCount: 0,
        bypassed: true,
        reason:
          keptCount === 0 ? 'all_segments_removed' : 'exceeded_safe_ratio_50',
      };
    }

    // ---------------------------------------------------------------------------
    // 重建列表：RFC 8216 状态机维护 Key/Map + G3 补齐 DISCONTINUITY
    // ---------------------------------------------------------------------------
    const out: string[] = [...headerLines];
    let effectiveKeys: string[] = [];
    let emittedKeys: string[] = [];
    let effectiveMaps: string[] = [];
    let emittedMaps: string[] = [];

    let hasEmittedFirstSeg = false;
    let lastTagWasDiscontinuity = false;
    let justSkippedAdBlock = false;

    for (const seg of segments) {
      const ownKeys = seg.tags.filter((t) => /^#EXT-X-KEY:/i.test(t));
      const ownMaps = seg.tags.filter((t) => /^#EXT-X-MAP:/i.test(t));

      // 核心修复：必须在判断 seg.isAd 之前先更新状态机，确保首片是广告时片头 Key/Map 不丢失
      if (ownKeys.length > 0) effectiveKeys = ownKeys;
      if (ownMaps.length > 0) effectiveMaps = ownMaps;

      if (seg.isAd) {
        justSkippedAdBlock = true;
        continue;
      }

      // 若中间有切片被剔除且当前分片未带 DISCONTINUITY，补偿一条平滑 PTS/DTS
      const hasOwnDisc = seg.tags.some((t) =>
        /^#EXT-X-DISCONTINUITY$/i.test(t)
      );
      if (
        justSkippedAdBlock &&
        hasEmittedFirstSeg &&
        !hasOwnDisc &&
        !lastTagWasDiscontinuity
      ) {
        out.push('#EXT-X-DISCONTINUITY');
        lastTagWasDiscontinuity = true;
      }
      justSkippedAdBlock = false;

      // 状态机补发 Key（支持多 KEYFORMAT）
      const keysDiffer =
        effectiveKeys.length !== emittedKeys.length ||
        effectiveKeys.some((k, i) => k !== emittedKeys[i]);

      if (ownKeys.length === 0 && effectiveKeys.length > 0 && keysDiffer) {
        out.push(...effectiveKeys);
        emittedKeys = [...effectiveKeys];
      } else if (ownKeys.length > 0) {
        emittedKeys = [...ownKeys];
      }

      // 状态机补发 Map
      const mapsDiffer =
        effectiveMaps.length !== emittedMaps.length ||
        effectiveMaps.some((m, i) => m !== emittedMaps[i]);

      if (ownMaps.length === 0 && effectiveMaps.length > 0 && mapsDiffer) {
        out.push(...effectiveMaps);
        emittedMaps = [...effectiveMaps];
      } else if (ownMaps.length > 0) {
        emittedMaps = [...ownMaps];
      }

      for (const tag of seg.tags) {
        if (/^#EXT-X-KEY:|^#EXT-X-MAP:/i.test(tag)) {
          out.push(tag);
          continue;
        }
        const isDisc = /^#EXT-X-DISCONTINUITY$/i.test(tag);
        if (isDisc) {
          if (!hasEmittedFirstSeg || lastTagWasDiscontinuity) continue;
          lastTagWasDiscontinuity = true;
        } else {
          lastTagWasDiscontinuity = false;
        }
        out.push(tag);
      }

      out.push(seg.absUrl);
      hasEmittedFirstSeg = true;
      lastTagWasDiscontinuity = false;
    }

    out.push(...footerLines);

    return {
      cleaned: out.join('\n'),
      removedCount: totalRemoved,
      bypassed: false,
    };
  } catch {
    // 工业级兜底：无任何 console 污染，静默放行保证播放绝不中断
    return {
      cleaned: content,
      removedCount: 0,
      bypassed: true,
      reason: 'exception_fallback',
    };
  }
}

/* eslint-disable no-console, react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
'use client';

import Hls from 'hls.js';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Film,
  HelpCircle,
  Info,
  Loader2,
  Play,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  generateStorageKey,
  getAllPlayRecords,
  savePlayRecord,
} from '@/lib/db.client';
import { PanItem } from '@/lib/openlist';

import PageLayout from '@/components/PageLayout';

interface PanPlayData {
  name: string;
  size: number;
  raw_url: string;
  path: string;
  modified?: string;
  thumb?: string;
  provider?: string;
  providerName?: string;
  isDirect302?: boolean;
  webProxy?: boolean;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const remS = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${h}:${pad(remM)}:${pad(remS)}`;
  }
  return `${pad(remM)}:${pad(remS)}`;
}

function PanPlayerClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filePath = searchParams.get('path') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playData, setPlayData] = useState<PanPlayData | null>(null);

  // 同目录兄弟视频列表（选集）
  const [siblings, setSiblings] = useState<PanItem[]>([]);
  const [loadingSiblings, setLoadingSiblings] = useState(false);

  // 复制直链状态
  const [copied, setCopied] = useState(false);
  // 302 指引弹窗状态
  const [showGuideModal, setShowGuideModal] = useState(false);

  // 播放器元素与 HLS 实例引用
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // 播放进度与断点续播
  const [savedTime, setSavedTime] = useState<number>(0);
  const [showResumeNotice, setShowResumeNotice] = useState(false);
  const resumeHandledRef = useRef(false);

  // 计算父级目录路径
  const parentDirectory = useMemo(() => {
    if (!filePath || filePath === '/') return '/';
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return filePath.slice(0, lastSlash);
  }, [filePath]);

  // 面包屑结构
  const breadcrumbs = useMemo(() => {
    const clean = filePath.replace(/\/+/g, '/').replace(/\/$/, '');
    if (!clean) return [{ name: '网盘根目录', path: '/' }];
    const parts = clean.split('/').filter(Boolean);
    const crumbs = [{ name: '网盘根目录', path: '/' }];
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc += '/' + parts[i];
      crumbs.push({ name: parts[i], path: acc });
    }
    return crumbs;
  }, [filePath]);

  // 获取视频直链数据
  const fetchPlayData = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    resumeHandledRef.current = false;
    setShowResumeNotice(false);

    try {
      const res = await fetch(`/api/pan/play?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || '获取视频直链失败');
      }
      setPlayData(json.data);
    } catch (err: any) {
      setError(err.message || '加载直链异常');
    } finally {
      setLoading(false);
    }
  }, []);

  // 读取同目录下的兄弟视频列表供同层选集
  const fetchSiblings = useCallback(async (parentPath: string) => {
    if (!parentPath) return;
    setLoadingSiblings(true);
    try {
      const res = await fetch(
        `/api/pan/list?path=${encodeURIComponent(parentPath)}`
      );
      const json = await res.json();
      if (json.ok && Array.isArray(json.data?.items)) {
        // 仅保留视频文件
        const videoItems = (json.data.items as PanItem[]).filter(
          (item) => !item.is_dir
        );
        setSiblings(videoItems);
      }
    } catch (err) {
      console.warn('获取同目录视频列表失败:', err);
    } finally {
      setLoadingSiblings(false);
    }
  }, []);

  useEffect(() => {
    if (!filePath) {
      setError('缺少播放路径参数');
      setLoading(false);
      return;
    }
    fetchPlayData(filePath);
    fetchSiblings(parentDirectory);
  }, [filePath, parentDirectory, fetchPlayData, fetchSiblings]);

  // 读取已保存的续播历史记录
  useEffect(() => {
    if (!filePath) return;
    getAllPlayRecords()
      .then((records) => {
        const key = generateStorageKey('pan', filePath);
        const record = records[key];
        if (record && record.play_time > 5) {
          setSavedTime(record.play_time);
          setShowResumeNotice(true);
        } else {
          setSavedTime(0);
          setShowResumeNotice(false);
        }
      })
      .catch(() => {});
  }, [filePath]);

  // 初始化播放器核心（自适应原生视频与 HLS）
  useEffect(() => {
    if (!playData?.raw_url || !videoRef.current) return;

    const videoEl = videoRef.current;
    const url = playData.raw_url;
    const isM3u8 =
      url.toLowerCase().includes('.m3u8') ||
      filePath.toLowerCase().endsWith('.m3u8');

    // 清理先前的 HLS 实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (isM3u8) {
      // HLS 播放模式
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.play().catch(() => {});
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
      }
    } else {
      // MP4 / MKV / WebM 等原生直接播放模式（302 直连客户端直接拉流，跳过任何 HLS 与去广告逻辑）
      videoEl.src = url;
      videoEl.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playData?.raw_url, filePath]);

  // 恢复播放进度
  const handleResumePlayback = () => {
    if (videoRef.current && savedTime > 0) {
      videoRef.current.currentTime = savedTime;
      videoRef.current.play().catch(() => {});
      setShowResumeNotice(false);
    }
  };

  // 自动保存播放进度定时器
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playData) return;

    const handleTimeUpdate = () => {
      if (!video || isNaN(video.currentTime) || video.currentTime < 2) return;

      // 首次如果已有历史进度且未提示过，可轻量恢复
      if (!resumeHandledRef.current && savedTime > 0) {
        resumeHandledRef.current = true;
        // 自动跳转到记忆点
        video.currentTime = savedTime;
      }
    };

    // 每 5 秒写一次历史记录
    const intervalId = setInterval(() => {
      if (
        video &&
        !video.paused &&
        !isNaN(video.currentTime) &&
        video.currentTime > 2
      ) {
        savePlayRecord('pan', filePath, {
          title: playData.name,
          source_name: '私人网盘',
          year: '',
          cover: playData.thumb || '',
          index: 1,
          total_episodes: 1,
          play_time: Math.floor(video.currentTime),
          total_time: Math.floor(video.duration || 0),
          save_time: Math.floor(Date.now() / 1000),
        }).catch(() => {});
      }
    }, 5000);

    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      clearInterval(intervalId);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      // 页面卸载或切集时保存最终进度
      if (video && !isNaN(video.currentTime) && video.currentTime > 2) {
        savePlayRecord('pan', filePath, {
          title: playData.name,
          source_name: '私人网盘',
          year: '',
          cover: playData.thumb || '',
          index: 1,
          total_episodes: 1,
          play_time: Math.floor(video.currentTime),
          total_time: Math.floor(video.duration || 0),
          save_time: Math.floor(Date.now() / 1000),
        }).catch(() => {});
      }
    };
  }, [playData, filePath, savedTime]);

  // 复制直链
  const handleCopyDirectUrl = async () => {
    if (!playData?.raw_url) return;
    try {
      await navigator.clipboard.writeText(playData.raw_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // 兼容不支持 clipboard API
      const input = document.createElement('input');
      input.value = playData.raw_url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // 唤起外部播放器
  const handleLaunchPlayer = (
    player: 'potplayer' | 'vlc' | 'iina' | 'infuse'
  ) => {
    if (!playData?.raw_url) return;
    const raw = playData.raw_url;
    let scheme = '';
    switch (player) {
      case 'potplayer':
        scheme = `potplayer://${raw}`;
        break;
      case 'vlc':
        scheme = `vlc://${raw}`;
        break;
      case 'iina':
        scheme = `iina://weblink?url=${encodeURIComponent(raw)}`;
        break;
      case 'infuse':
        scheme = `infuse://x-callback-url/play?url=${encodeURIComponent(raw)}`;
        break;
    }
    if (scheme) {
      window.location.href = scheme;
    }
  };

  // 切集
  const handleSelectSibling = (siblingPath: string) => {
    if (siblingPath === filePath) return;
    router.push(`/pan/play?path=${encodeURIComponent(siblingPath)}`);
  };

  return (
    <PageLayout activePath='/pan'>
      <div className='px-4 sm:px-8 py-6 max-w-7xl mx-auto'>
        {/* 面包屑导航与返回目录 */}
        <div className='flex items-center justify-between mb-4'>
          <div className='flex items-center gap-2 text-sm overflow-x-auto scrollbar-hide py-1'>
            <Link
              href={`/pan?path=${encodeURIComponent(parentDirectory)}`}
              className='inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-medium transition-colors shrink-0'
            >
              <ArrowLeft className='w-3.5 h-3.5' />
              返回上级目录
            </Link>

            <span className='text-gray-300 dark:text-gray-600 shrink-0'>|</span>

            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const isRoot = idx === 0;
              const isFile = isLast;
              return (
                <div
                  key={crumb.path}
                  className='flex items-center gap-1.5 shrink-0'
                >
                  {idx > 0 && (
                    <ChevronRight className='w-3.5 h-3.5 text-gray-400 shrink-0' />
                  )}
                  {isFile ? (
                    <span className='font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[220px]'>
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      href={
                        isRoot
                          ? '/pan'
                          : `/pan?path=${encodeURIComponent(crumb.path)}`
                      }
                      className='text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400 transition-colors truncate max-w-[150px]'
                    >
                      {crumb.name}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 核心播放区域 */}
        {loading ? (
          <div className='flex flex-col items-center justify-center py-28 bg-black/90 rounded-2xl text-white mb-6'>
            <Loader2 className='w-10 h-10 animate-spin text-green-500 mb-4' />
            <p className='text-sm text-gray-300'>正在解析网盘直链...</p>
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-center mb-6'>
            <AlertCircle className='w-12 h-12 text-red-500 mb-3' />
            <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 mb-1'>
              视频播放失败
            </h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6'>
              {error}
            </p>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => fetchPlayData(filePath)}
                className='px-4 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors'
              >
                重新加载
              </button>
              <Link
                href={`/pan?path=${encodeURIComponent(parentDirectory)}`}
                className='px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
              >
                返回目录
              </Link>
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8'>
            {/* 左侧：播放器与工具栏 (占 3 列) */}
            <div className='lg:col-span-3 space-y-4'>
              {/* 播放器容器 */}
              <div className='relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-900'>
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  autoPlay
                  preload='auto'
                  className='w-full h-full object-contain'
                />

                {/* 恢复历史进度提示小条 */}
                {showResumeNotice && savedTime > 0 && (
                  <div className='absolute bottom-16 left-4 right-4 sm:left-6 sm:right-auto z-20 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gray-900/90 text-white backdrop-blur-md border border-gray-700/80 shadow-lg text-xs'>
                    <span>上次看到 {formatTime(savedTime)}</span>
                    <div className='flex items-center gap-2'>
                      <button
                        onClick={handleResumePlayback}
                        className='px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 font-medium transition-colors'
                      >
                        跳转播放
                      </button>
                      <button
                        onClick={() => setShowResumeNotice(false)}
                        className='text-gray-400 hover:text-white transition-colors'
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 视频标题与信息 */}
              <div className='bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 border border-gray-200/80 dark:border-gray-700/60 shadow-sm'>
                <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 dark:border-gray-700/60 pb-4'>
                  <div className='min-w-0 flex-1'>
                    <h2
                      className='text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 break-all'
                      title={playData?.name}
                    >
                      {playData?.name}
                    </h2>
                    <div className='flex flex-wrap items-center gap-2.5 mt-2 text-xs'>
                      <span className='text-gray-500 dark:text-gray-400'>
                        文件大小: {formatFileSize(playData?.size || 0)}
                      </span>
                      <span className='text-gray-300 dark:text-gray-600'>
                        •
                      </span>
                      <span className='text-gray-500 dark:text-gray-400'>
                        网盘来源:{' '}
                        <strong className='text-gray-700 dark:text-gray-200 font-semibold'>
                          {playData?.providerName ||
                            playData?.provider ||
                            '私人网盘'}
                        </strong>
                      </span>
                      <span className='text-gray-300 dark:text-gray-600'>
                        •
                      </span>
                      {playData?.isDirect302 ? (
                        <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80'>
                          <span className='w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse'></span>
                          302 客户端直连 (0服务器流量)
                        </span>
                      ) : (
                        <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800/80'>
                          <AlertTriangle className='w-3.5 h-3.5 text-amber-600 dark:text-amber-400' />
                          AList 代理中转 (消耗服务器带宽)
                        </span>
                      )}
                      <button
                        type='button'
                        onClick={() => setShowGuideModal(true)}
                        className='text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 transition-colors'
                      >
                        <HelpCircle className='w-3.5 h-3.5' />
                        如何改302直连？
                      </button>
                    </div>
                  </div>

                  {/* 复制直链按钮 */}
                  <button
                    onClick={handleCopyDirectUrl}
                    className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className='w-4 h-4' />
                        直链已复制
                      </>
                    ) : (
                      <>
                        <Copy className='w-4 h-4' />
                        复制视频直链
                      </>
                    )}
                  </button>
                </div>

                {/* 代理中转模式警告与改造指引 */}
                {playData && !playData.isDirect302 && (
                  <div className='mt-3.5 p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-900 dark:text-amber-200'>
                    <div className='flex flex-wrap items-center justify-between gap-2 font-semibold text-amber-800 dark:text-amber-300'>
                      <span className='flex items-center gap-1.5'>
                        <AlertTriangle className='w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0' />
                        注意：当前视频通过 AList
                        代理中转传输，正在占用你的服务器流量与带宽！
                      </span>
                      <button
                        type='button'
                        onClick={() => setShowGuideModal(true)}
                        className='underline text-amber-700 dark:text-amber-300 hover:text-amber-900 font-medium'
                      >
                        查看 302 直连改法教程 →
                      </button>
                    </div>
                    <div className='mt-1.5 text-gray-600 dark:text-gray-300 leading-relaxed'>
                      <b>若要改为 302 客户端直连（0 服务器流量占用）</b>：请登录
                      AList 后台 →「存储」→ 编辑该网盘：
                      <b>关闭「Web 代理 (Web Proxy)」</b>并将
                      <b>「WebDAV 策略」更改为「302 重定向 (302_redirect)」</b>
                      后保存。
                    </div>
                  </div>
                )}

                {/* 外部播放器唤起栏 (解决浏览器特殊音轨无声痛点) */}
                <div className='pt-4'>
                  <div className='flex items-center gap-2 mb-2'>
                    <ExternalLink className='w-4 h-4 text-green-600 dark:text-green-400' />
                    <span className='text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200'>
                      一键唤起外部本地播放器 (推荐)
                    </span>
                  </div>

                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      onClick={() => handleLaunchPlayer('potplayer')}
                      className='px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200/60 dark:border-amber-800/60 transition-colors'
                    >
                      PotPlayer (Windows)
                    </button>
                    <button
                      onClick={() => handleLaunchPlayer('vlc')}
                      className='px-3.5 py-1.5 rounded-lg text-xs font-medium bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200/60 dark:border-orange-800/60 transition-colors'
                    >
                      VLC 播放器 (全平台)
                    </button>
                    <button
                      onClick={() => handleLaunchPlayer('iina')}
                      className='px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200/60 dark:border-blue-800/60 transition-colors'
                    >
                      IINA (macOS)
                    </button>
                    <button
                      onClick={() => handleLaunchPlayer('infuse')}
                      className='px-3.5 py-1.5 rounded-lg text-xs font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200/60 dark:border-purple-800/60 transition-colors'
                    >
                      Infuse (Apple全家桶)
                    </button>
                  </div>

                  <div className='flex items-start gap-1.5 mt-3 text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/30 p-2.5 rounded-lg'>
                    <Info className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5' />
                    <span>
                      小贴士：部分 MKV 格式视频内嵌有特殊音频编码（如 DTS / AC3
                      /
                      TrueHD），主流浏览器受专利限制通常无法解码声音。遇到无声音时，点击上方播放器按钮即可直接拉起本地播放器进行原画硬解播放！
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：同目录视频 / 选集列表 (占 1 列) */}
            <div className='lg:col-span-1'>
              <div className='bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-200/80 dark:border-gray-700/60 shadow-sm flex flex-col h-full max-h-[700px]'>
                <div className='flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-700/60'>
                  <div className='flex items-center gap-2'>
                    <Film className='w-4 h-4 text-green-600' />
                    <h3 className='text-sm font-bold text-gray-900 dark:text-gray-100'>
                      同目录选集 ({siblings.length})
                    </h3>
                  </div>
                </div>

                <div className='flex-1 overflow-y-auto space-y-1.5 mt-3 pr-1'>
                  {loadingSiblings ? (
                    <div className='flex justify-center py-8 text-gray-400'>
                      <Loader2 className='w-5 h-5 animate-spin' />
                    </div>
                  ) : siblings.length === 0 ? (
                    <div className='text-xs text-gray-400 py-6 text-center'>
                      目录中无其他视频
                    </div>
                  ) : (
                    siblings.map((item) => {
                      const isPlaying = item.path === filePath;
                      return (
                        <div
                          key={item.path}
                          onClick={() => handleSelectSibling(item.path)}
                          className={`group cursor-pointer p-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                            isPlaying
                              ? 'bg-green-500/10 dark:bg-green-500/20 text-green-700 dark:text-green-300 font-semibold border border-green-500/30'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          <div className='flex items-center gap-2 min-w-0 flex-1'>
                            {isPlaying ? (
                              <Play className='w-3.5 h-3.5 fill-current text-green-600 shrink-0' />
                            ) : (
                              <div className='w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0' />
                            )}
                            <span className='truncate'>{item.name}</span>
                          </div>
                          <span className='text-[10px] text-gray-400 shrink-0 ml-2'>
                            {formatFileSize(item.size)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 302 直连配置指引弹窗 */}
        {showGuideModal && (
          <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200'>
            <div className='bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700 space-y-4'>
              <div className='flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3'>
                <div className='flex items-center gap-2'>
                  <div className='w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center font-bold text-sm'>
                    302
                  </div>
                  <h3 className='text-base font-bold text-gray-900 dark:text-gray-100'>
                    网盘如何开启 302 客户端直连？
                  </h3>
                </div>
                <button
                  type='button'
                  onClick={() => setShowGuideModal(false)}
                  className='p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>

              <div className='space-y-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed'>
                <div className='p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-xl text-blue-900 dark:text-blue-200'>
                  <b>什么是 302 直连？</b>
                  <p className='mt-1 text-xs text-blue-800/90 dark:text-blue-300'>
                    视频直接从网盘官方
                    CDN（如夸克、中国移动云盘、阿里云盘等）拉取流，
                    <b>不经过你的 AList 服务器中转</b>
                    。不仅播放速度最快（跑满用户宽带），而且{' '}
                    <b>0 消耗你服务器的下行与上行流量</b>。
                  </p>
                </div>

                <div className='space-y-2'>
                  <div className='font-semibold text-gray-800 dark:text-gray-200'>
                    只需两步修改配置（以 AList 管理后台为例）：
                  </div>
                  <div className='flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/40'>
                    <span className='w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold'>
                      1
                    </span>
                    <div>
                      <b>进入 AList 存储管理</b>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                        登录 AList
                        管理后台，在左侧菜单点击「存储」，找到对应的网盘挂载点点击「编辑」。
                      </p>
                    </div>
                  </div>

                  <div className='flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/40'>
                    <span className='w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold'>
                      2
                    </span>
                    <div>
                      <b>关闭 Web 代理并开启 302 重定向</b>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                        找到 <b>「Web 代理 (Web Proxy)」</b>，将其
                        <b>关闭（不勾选）</b>；<br />
                        找到 <b>「WebDAV 策略」</b>，选择为{' '}
                        <b>「302_redirect (302 重定向)」</b>。
                      </p>
                    </div>
                  </div>
                </div>

                <div className='text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3'>
                  💡 提示：保存后返回 NovaTV 重新播放，状态即会自动切换为「302
                  客户端直连」状态。若挂载的是本地磁盘
                  (Local)，因本就在服务器上，会继续保留本地服务模式。
                </div>
              </div>

              <div className='pt-2 flex justify-end'>
                <button
                  type='button'
                  onClick={() => setShowGuideModal(false)}
                  className='px-4 py-2 rounded-xl text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors'
                >
                  我知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function PanPlayPage() {
  return (
    <Suspense
      fallback={
        <PageLayout activePath='/pan'>
          <div className='flex justify-center items-center py-24'>
            <Loader2 className='w-8 h-8 animate-spin text-green-600' />
          </div>
        </PageLayout>
      }
    >
      <PanPlayerClient />
    </Suspense>
  );
}

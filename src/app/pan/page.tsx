/* eslint-disable no-console, react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Database,
  FileVideo,
  Folder,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { PanItem } from '@/lib/openlist';

import PageLayout from '@/components/PageLayout';

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

function formatModifiedDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function getExtensionBadge(filename: string): { label: string; color: string } {
  const dot = filename.lastIndexOf('.');
  const ext = dot !== -1 ? filename.slice(dot + 1).toUpperCase() : 'VIDEO';
  switch (ext) {
    case 'MP4':
      return {
        label: 'MP4',
        color:
          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      };
    case 'MKV':
      return {
        label: 'MKV',
        color:
          'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      };
    case 'M3U8':
      return {
        label: 'HLS',
        color:
          'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      };
    case 'MOV':
      return {
        label: 'MOV',
        color:
          'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
      };
    case 'WEBM':
      return {
        label: 'WEBM',
        color:
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      };
    default:
      return {
        label: ext,
        color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      };
  }
}

function PanBrowserClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPath = searchParams.get('path') || '/';

  const [items, setItems] = useState<PanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索关键字
  const [keyword, setKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // 面包屑结构
  const breadcrumbs = useMemo(() => {
    const clean = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
    if (!clean || clean === '') {
      return [{ name: '网盘根目录', path: '/' }];
    }
    const parts = clean.split('/').filter(Boolean);
    const crumbs = [{ name: '网盘根目录', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      crumbs.push({ name: part, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  // 获取目录列表
  const fetchDirectory = useCallback(async (path: string, kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      query.set('path', path);
      if (kw && kw.trim()) {
        query.set('keyword', kw.trim());
        setIsSearching(true);
      } else {
        setIsSearching(false);
      }

      const res = await fetch(`/api/pan/list?${query.toString()}`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || '获取网盘目录失败');
      }

      setItems(data.data?.items || []);
    } catch (err: any) {
      setError(err.message || '加载异常');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDirectory(currentPath, keyword);
  }, [currentPath, fetchDirectory]);

  // 处理搜索
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDirectory(currentPath, keyword);
  };

  const handleClearSearch = () => {
    setKeyword('');
    fetchDirectory(currentPath, '');
  };

  // 进入子目录
  const handleNavigate = (targetPath: string) => {
    setKeyword('');
    router.push(`/pan?path=${encodeURIComponent(targetPath)}`);
  };

  // 点击视频进入播放
  const handlePlayVideo = (targetPath: string) => {
    router.push(`/pan/play?path=${encodeURIComponent(targetPath)}`);
  };

  // 返回上一级
  const handleGoBack = () => {
    if (breadcrumbs.length <= 1) return;
    const parent = breadcrumbs[breadcrumbs.length - 2];
    handleNavigate(parent.path);
  };

  return (
    <PageLayout activePath='/pan'>
      <div className='px-4 sm:px-8 py-6 max-w-7xl mx-auto'>
        {/* 顶部标题栏与说明 */}
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6'>
          <div className='flex items-center gap-3'>
            <div className='p-2.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400'>
              <HardDrive className='w-6 h-6' />
            </div>
            <div>
              <h1 className='text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                私人网盘影库
                <span className='text-xs font-normal px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'>
                  302 客户端直连
                </span>
              </h1>
              <p className='text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5'>
                安全对接 OpenList / AList，视频流量不经服务端，直连云端高速拉流
              </p>
            </div>
          </div>

          {/* 搜索框与刷新按钮 */}
          <div className='flex items-center gap-2'>
            <form
              onSubmit={handleSearchSubmit}
              className='relative flex-1 sm:w-64'
            >
              <input
                type='text'
                placeholder='在此目录下搜索视频...'
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className='w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
              />
              <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400' />
              {keyword && (
                <button
                  type='button'
                  onClick={handleClearSearch}
                  className='absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                >
                  <X className='w-4 h-4' />
                </button>
              )}
            </form>
            <button
              onClick={() => fetchDirectory(currentPath, keyword)}
              disabled={loading}
              title='刷新目录'
              className='p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50'
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* 面包屑导航栏 */}
        <div className='flex items-center justify-between bg-white dark:bg-gray-800/80 rounded-xl px-4 py-3 border border-gray-200/80 dark:border-gray-700/60 mb-6 backdrop-blur-md shadow-sm overflow-x-auto scrollbar-hide'>
          <div className='flex items-center gap-1.5 text-sm min-w-0'>
            {currentPath !== '/' && (
              <button
                onClick={handleGoBack}
                className='mr-2 p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                title='返回上一级'
              >
                <ArrowLeft className='w-4 h-4' />
              </button>
            )}
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <div
                  key={crumb.path}
                  className='flex items-center gap-1.5 shrink-0'
                >
                  {idx > 0 && (
                    <ChevronRight className='w-3.5 h-3.5 text-gray-400 shrink-0' />
                  )}
                  {isLast ? (
                    <span className='font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[200px]'>
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleNavigate(crumb.path)}
                      className='text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400 transition-colors truncate max-w-[150px]'
                    >
                      {crumb.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isSearching && (
            <div className='text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 ml-4 shrink-0'>
              <span>搜索结果: 「{keyword}」</span>
              <button
                onClick={handleClearSearch}
                className='underline hover:opacity-80'
              >
                退出搜索
              </button>
            </div>
          )}
        </div>

        {/* 内容主体 */}
        {loading ? (
          <div className='flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400'>
            <Loader2 className='w-8 h-8 animate-spin text-green-600 mb-3' />
            <p className='text-sm'>正在读取网盘目录...</p>
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-center'>
            <AlertCircle className='w-12 h-12 text-red-500 mb-3' />
            <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 mb-1'>
              无法读取网盘内容
            </h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6'>
              {error}
            </p>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => fetchDirectory(currentPath, keyword)}
                className='px-4 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors'
              >
                重试加载
              </button>
              <Link
                href='/'
                className='px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
              >
                返回首页
              </Link>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 text-center p-6'>
            <Database className='w-12 h-12 text-gray-400 mb-3' />
            <h3 className='text-base font-medium text-gray-900 dark:text-gray-100 mb-1'>
              {isSearching ? '未找到相关视频' : '当前文件夹为空'}
            </h3>
            <p className='text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-sm'>
              {isSearching
                ? '尝试换个关键词，或清除搜索框查看全部文件'
                : '该目录下没有找到可播放的视频或子文件夹'}
            </p>
            {isSearching && (
              <button
                onClick={handleClearSearch}
                className='mt-4 px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors'
              >
                清除搜索
              </button>
            )}
          </div>
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4'>
            {items.map((item) => {
              if (item.is_dir) {
                // 文件夹卡片
                return (
                  <div
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                    className='group cursor-pointer flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/60 hover:border-green-500/50 dark:hover:border-green-500/50 hover:shadow-md transition-all duration-200'
                  >
                    <div className='flex items-center gap-3 min-w-0 flex-1'>
                      <div className='p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform shrink-0'>
                        <Folder className='w-5 h-5 fill-current' />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                          {item.name}
                        </h4>
                        <span className='text-xs text-gray-400 dark:text-gray-500'>
                          文件夹
                        </span>
                      </div>
                    </div>
                    <ChevronRight className='w-4 h-4 text-gray-400 group-hover:text-green-600 dark:group-hover:text-green-400 group-hover:translate-x-0.5 transition-all shrink-0 ml-2' />
                  </div>
                );
              }

              // 视频文件卡片
              const badge = getExtensionBadge(item.name);
              const modified = formatModifiedDate(item.modified);

              return (
                <div
                  key={item.path}
                  onClick={() => handlePlayVideo(item.path)}
                  className='group cursor-pointer flex flex-col justify-between p-3.5 sm:p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/60 hover:border-green-500/50 dark:hover:border-green-500/50 hover:shadow-md transition-all duration-200'
                >
                  <div className='flex items-start gap-3 min-w-0'>
                    <div className='p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 group-hover:scale-105 transition-transform shrink-0 mt-0.5'>
                      <FileVideo className='w-5 h-5' />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h4
                        className='text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'
                        title={item.name}
                      >
                        {item.name}
                      </h4>
                    </div>
                  </div>

                  {/* 底部信息条：文件大小、格式徽章、播放按钮 */}
                  <div className='flex items-center justify-between pt-3 mt-2 border-t border-gray-100 dark:border-gray-700/50 text-xs text-gray-500 dark:text-gray-400'>
                    <div className='flex items-center gap-2'>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                      <span>{formatFileSize(item.size)}</span>
                      {modified && (
                        <span className='hidden sm:inline text-gray-400'>
                          • {modified.slice(5, 10)}
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-1 text-green-600 dark:text-green-400 font-medium group-hover:translate-x-0.5 transition-transform'>
                      <Play className='w-3.5 h-3.5 fill-current' />
                      <span>播放</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function PanBrowserPage() {
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
      <PanBrowserClient />
    </Suspense>
  );
}

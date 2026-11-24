/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  GripVertical,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import Swal from 'sweetalert2';

import { AdminConfig, AdminConfigResult, PanConfig } from '@/lib/admin.types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import PageLayout from '@/components/PageLayout';

// 统一弹窗方法（必须在首次使用前定义）
const showError = (message: string) =>
  Swal.fire({ icon: 'error', title: '错误', text: message });

const showSuccess = (message: string) =>
  Swal.fire({
    icon: 'success',
    title: '成功',
    text: message,
    timer: 2000,
    showConfirmButton: false,
  });

// 美化版弹窗(淡入淡出、无回弹动画、主题按钮、深色适配)
// 目前用于:修改密码、设备上限、系统更新相关确认
const styledSwal = Swal.mixin({
  buttonsStyling: false,
  showClass: { popup: 'admin-swal-in', backdrop: 'admin-swal-backdrop' },
  hideClass: { popup: 'admin-swal-out', backdrop: 'admin-swal-backdrop' },
  customClass: {
    popup: 'admin-swal-popup',
    title: 'admin-swal-title',
    htmlContainer: 'admin-swal-html',
    input: 'admin-swal-input',
    confirmButton: 'admin-swal-btn admin-swal-btn-primary',
    cancelButton: 'admin-swal-btn admin-swal-btn-secondary',
  },
});

// 新增站点配置类型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  ImageProxy: string;
  DoubanProxy: string;
  DisableYellowFilter: boolean;
}

// 视频源数据类型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 视频源测速结果
interface SourceProbeResult {
  key: string;
  ok: boolean;
  ms: number | null;
  status?: number;
  count?: number;
  error?: string;
}

// 自定义分类数据类型
interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 可折叠标签组件
interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700'>
      <button
        onClick={onToggle}
        className='w-full px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
        </div>
        <div className='text-gray-500 dark:text-gray-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && (
        <div className='px-3 py-3 sm:px-6 sm:py-4'>{children}</div>
      )}
    </div>
  );
};

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const [userSettings, setUserSettings] = useState({
    enableRegistration: false,
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
  });
  // 用户访问统计：{ [username]: { logs: [...], usage_total, devices: [...] } }
  const [accessData, setAccessData] = useState<{
    [key: string]: { logs: any[]; usage_total: number; devices?: any[] };
  }>({});
  // 当前展开查看访问记录的用户
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 检测存储类型是否为 d1
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  useEffect(() => {
    if (config?.UserConfig) {
      setUserSettings({
        enableRegistration: config.UserConfig.AllowRegister,
      });
    }
  }, [config]);

  // 拉取用户访问统计（使用时长/上线时间/IP）
  const fetchAccessData = useCallback(async () => {
    if (!role) return;
    try {
      const res = await fetch('/api/admin/access');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.users) {
        setAccessData(data.users);
      }
    } catch (err) {
      console.error('获取用户访问统计失败:', err);
    }
  }, [role]);

  useEffect(() => {
    fetchAccessData();
    const timer = setInterval(fetchAccessData, 60 * 1000); // 每分钟刷新
    return () => clearInterval(timer);
  }, [fetchAccessData]);

  // 格式化使用时长
  const formatUsageDuration = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '0 分钟';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days} 天 ${hours} 小时`;
    if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
    if (minutes > 0) return `${minutes} 分钟`;
    return `${seconds} 秒`;
  };

  // 格式化时间戳为本地时间字符串
  const formatAccessTime = (ts: number): string => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 切换允许注册设置
  const toggleAllowRegister = async (value: boolean) => {
    try {
      // 先更新本地 UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: value }));

      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAllowRegister',
          allowRegister: value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      // revert toggle UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: !value }));
    }
  };

  const handleBanUser = async (uname: string) => {
    await handleUserAction('ban', uname);
  };

  const handleUnbanUser = async (uname: string) => {
    await handleUserAction('unban', uname);
  };

  const handleSetAdmin = async (uname: string) => {
    await handleUserAction('setAdmin', uname);
  };

  const handleRemoveAdmin = async (uname: string) => {
    await handleUserAction('cancelAdmin', uname);
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await handleUserAction('add', newUser.username, newUser.password);
    setNewUser({ username: '', password: '' });
    setShowAddUserForm(false);
  };

  // 修改用户密码(弹框形式)
  const handleSetPassword = async (username: string) => {
    const { value } = await styledSwal.fire({
      title: '修改用户密码',
      inputLabel: `为用户 ${username} 设置新密码`,
      input: 'password',
      inputPlaceholder: '请输入新密码',
      showCancelButton: true,
      confirmButtonText: '确认修改',
      cancelButtonText: '取消',
      inputValidator: (input) => {
        if (!input) return '请输入新密码';
        return null;
      },
    });
    if (!value) return;
    await handleUserAction('changePassword', username, value);
  };

  const handleDeleteUser = async (username: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '确认删除用户',
      text: `删除用户 ${username} 将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    await handleUserAction('deleteUser', username);
  };

  // 通用请求函数（返回是否成功，便于调用方决定是否提示成功）
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'setDeviceLimit'
      | 'changePassword'
      | 'deleteUser'
      | 'setAllowPan',
    targetUsername: string,
    targetPassword?: string,
    targetDeviceLimit?: number,
    targetAllowPan?: boolean
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          ...(typeof targetDeviceLimit === 'number'
            ? { targetDeviceLimit }
            : {}),
          ...(typeof targetAllowPan === 'boolean' ? { targetAllowPan } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置（无需整页刷新）
      await refreshConfig();
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  };

  const handleTogglePan = async (username: string, allow: boolean) => {
    const ok = await handleUserAction(
      'setAllowPan',
      username,
      undefined,
      undefined,
      allow
    );
    if (ok) {
      showSuccess(
        allow
          ? `已为用户 ${username} 开通私人网盘权限`
          : `已关闭用户 ${username} 的私人网盘权限`
      );
    }
  };

  // 设置用户登录设备数量上限（0 = 不限制）
  const handleSetDeviceLimit = async (username: string) => {
    const currentLimit =
      config?.UserConfig.Users.find((u) => u.username === username)
        ?.device_limit ?? 0;
    const { value } = await styledSwal.fire({
      title: '设置登录设备上限',
      input: 'number',
      inputLabel: `用户 ${username} 可同时登录的设备数量（0 表示不限制）`,
      inputValue: String(currentLimit),
      inputAttributes: { min: '0', max: '99', step: '1' },
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (input) => {
        const num = Number(input);
        if (!input || !Number.isInteger(num) || num < 0 || num > 99) {
          return '请输入 0-99 的整数';
        }
        return null;
      },
    });

    if (value === undefined || value === null) return; // 用户取消
    const limit = Number(value);
    const ok = await handleUserAction(
      'setDeviceLimit',
      username,
      undefined,
      limit
    );
    if (ok) {
      showSuccess(
        limit === 0 ? '已设为不限制设备数' : `设备上限已设为 ${limit} 台`
      );
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  // 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他
  const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
    const priority = (u: (typeof config.UserConfig.Users)[number]) => {
      if (u.username === currentUsername) return 0;
      if (u.role === 'owner') return 1;
      if (u.role === 'admin') return 2;
      return 3;
    };
    return priority(a) - priority(b);
  });

  type UserEntry = (typeof config.UserConfig.Users)[number];

  // 角色徽章（桌面表格与移动端卡片共用）
  const renderRoleBadge = (user: UserEntry) => (
    <span
      className={`px-2 py-1 text-xs rounded-full ${
        user.role === 'owner'
          ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
          : user.role === 'admin'
          ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
      }`}
    >
      {user.role === 'owner'
        ? '站长'
        : user.role === 'admin'
        ? '管理员'
        : '普通用户'}
    </span>
  );

  // 状态徽章（桌面表格与移动端卡片共用）
  const renderStatusBadge = (user: UserEntry) => (
    <span
      className={`px-2 py-1 text-xs rounded-full ${
        !user.banned
          ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
          : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
      }`}
    >
      {!user.banned ? '正常' : '已封禁'}
    </span>
  );

  // 网盘权限徽章（桌面表格与移动端卡片共用）
  const renderPanBadge = (user: UserEntry) => {
    const isOwnerOrAdmin = user.role === 'owner' || user.role === 'admin';
    if (isOwnerOrAdmin) {
      return (
        <span className='px-2 py-1 text-xs rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 font-medium'>
          网盘(默认全权)
        </span>
      );
    }
    return (
      <span
        className={`px-2 py-1 text-xs rounded-full ${
          user.allowPan
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 font-medium'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
        }`}
      >
        {user.allowPan ? '网盘已开通' : '网盘未授权'}
      </span>
    );
  };

  // 用户操作按钮（桌面表格与移动端卡片共用），加大触控目标
  const renderUserActions = (user: UserEntry) => {
    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
    const canChangePassword =
      user.role !== 'owner' && // 不能修改站长密码
      (role === 'owner' || // 站长可以修改管理员和普通用户密码
        (role === 'admin' &&
          (user.role === 'user' || user.username === currentUsername))); // 管理员可以修改普通用户和自己的密码

    // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
    const canDeleteUser =
      user.username !== currentUsername &&
      (role === 'owner' || // 站长可以删除除自己外的所有用户
        (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
    const canOperate =
      user.username !== currentUsername &&
      (role === 'owner' || (role === 'admin' && user.role === 'user'));

    return (
      <div className='flex flex-wrap items-center gap-2'>
        {/* 访问记录按钮 */}
        <button
          onClick={() =>
            setExpandedUser(
              expandedUser === user.username ? null : user.username
            )
          }
          className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60 dark:text-indigo-200 transition-colors'
        >
          {expandedUser === user.username ? '收起记录' : '访问记录'}
        </button>
        {/* 修改密码按钮 */}
        {canChangePassword && (
          <button
            onClick={() => handleSetPassword(user.username)}
            className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors'
          >
            修改密码
          </button>
        )}
        {canOperate && (
          <>
            {/* 设备上限按钮 */}
            <button
              onClick={() => handleSetDeviceLimit(user.username)}
              className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-900/40 dark:hover:bg-teal-900/60 dark:text-teal-200 transition-colors'
            >
              设备上限
            </button>
            {/* 网盘权限开关（普通用户可单独授权） */}
            {user.role === 'user' && (
              <button
                onClick={() => handleTogglePan(user.username, !user.allowPan)}
                className={`inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium transition-colors ${
                  user.allowPan
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 dark:text-amber-200'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 dark:text-emerald-200'
                }`}
              >
                {user.allowPan ? '关闭网盘' : '开通网盘'}
              </button>
            )}
            {/* 其他操作按钮 */}
            {user.role === 'user' && (
              <button
                onClick={() => handleSetAdmin(user.username)}
                className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/40 dark:hover:bg-purple-900/60 dark:text-purple-200 transition-colors'
              >
                设为管理
              </button>
            )}
            {user.role === 'admin' && (
              <button
                onClick={() => handleRemoveAdmin(user.username)}
                className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
              >
                取消管理
              </button>
            )}
            {user.role !== 'owner' &&
              (!user.banned ? (
                <button
                  onClick={() => handleBanUser(user.username)}
                  className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 transition-colors'
                >
                  封禁
                </button>
              ) : (
                <button
                  onClick={() => handleUnbanUser(user.username)}
                  className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-300 transition-colors'
                >
                  解封
                </button>
              ))}
          </>
        )}
        {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
        {canDeleteUser && (
          <button
            onClick={() => handleDeleteUser(user.username)}
            className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors'
          >
            删除用户
          </button>
        )}
      </div>
    );
  };

  // 访问记录与登录设备面板（桌面表格展开行与移动端卡片共用，紧凑行式布局免横向滚动）
  const renderUserAccessPanel = (user: UserEntry) => {
    const logs = accessData[user.username]?.logs || [];
    const devices = (accessData[user.username]?.devices || []).filter(
      (d) => Number(d.session_time) > 0
    );
    return (
      <>
        <div className='text-xs font-medium text-gray-500 dark:text-gray-400 mb-2'>
          最近访问记录（最多保留10次）
        </div>
        {logs.length === 0 ? (
          <div className='text-sm text-gray-400 dark:text-gray-500'>
            暂无访问记录
          </div>
        ) : (
          <div className='space-y-1.5'>
            {logs.map((log, idx) => (
              <div
                key={idx}
                className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-900 dark:text-gray-100'
              >
                <span className='font-medium whitespace-nowrap'>
                  上线 {formatAccessTime(log.login_time)}
                </span>
                <span className='font-mono text-xs text-gray-600 dark:text-gray-300'>
                  {log.ip || '-'}
                </span>
                <span className='text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap'>
                  在线{' '}
                  {formatUsageDuration(
                    Math.max(
                      0,
                      (log.last_active || log.login_time) - log.login_time
                    )
                  )}
                </span>
                <span className='text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap'>
                  活跃 {formatAccessTime(log.last_active)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 登录设备列表（超过设备上限时最早登录的设备失效） */}
        <div className='text-xs font-medium text-gray-500 dark:text-gray-400 mt-4 mb-2'>
          登录设备（共 {devices.length} 台 · 上限{' '}
          {user.device_limit && user.device_limit > 0
            ? `${user.device_limit} 台`
            : '不限制'}
          ）
        </div>
        {devices.length === 0 ? (
          <div className='text-sm text-gray-400 dark:text-gray-500'>
            暂无登录设备
          </div>
        ) : (
          <div className='space-y-1.5'>
            {devices.map((device, idx) => (
              <div
                key={idx}
                className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-900 dark:text-gray-100'
              >
                <span className='font-medium break-all'>
                  {device.ua || '未知设备'}
                </span>
                <span className='text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap'>
                  {formatAccessTime(Math.floor(device.session_time / 1000))}
                </span>
                <span className='font-mono text-xs text-gray-400 dark:text-gray-500'>
                  {String(device.device_id || '').slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 flex items-center gap-3'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>
      </div>

      {/* 注册设置 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          注册设置
        </h4>
        <div className='flex items-center justify-between'>
          <label
            className={`text-gray-700 dark:text-gray-300 ${
              isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
          >
            允许新用户注册
            {isD1Storage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (D1 环境下请通过环境变量修改)
              </span>
            )}
            {isUpstashStorage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (Upstash 环境下请通过环境变量修改)
              </span>
            )}
          </label>
          <button
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              toggleAllowRegister(!userSettings.enableRegistration)
            }
            disabled={isD1Storage || isUpstashStorage}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              userSettings.enableRegistration
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
            } ${
              isD1Storage || isUpstashStorage
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                userSettings.enableRegistration
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <button
            onClick={() => setShowAddUserForm(!showAddUserForm)}
            className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
          >
            {showAddUserForm ? '取消' : '添加用户'}
          </button>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={newUser.username}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, username: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <input
                type='password'
                placeholder='密码'
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, password: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <button
                onClick={handleAddUser}
                disabled={!newUser.username || !newUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                添加
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div className='hidden md:block border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  网盘权限
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  使用时长
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  最近上线
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  最近IP
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {sortedUsers.map((user) => {
                return (
                  <Fragment key={user.username}>
                    <tr className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'>
                      <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {user.username}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        {renderRoleBadge(user)}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        {renderStatusBadge(user)}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        {renderPanBadge(user)}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                        {formatUsageDuration(
                          accessData[user.username]?.usage_total || 0
                        )}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                        {(() => {
                          const logs = accessData[user.username]?.logs || [];
                          if (logs.length === 0) return '-';
                          const latest = logs[0];
                          return formatAccessTime(
                            latest.last_active || latest.login_time
                          );
                        })()}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                        {accessData[user.username]?.logs?.[0]?.ip || '-'}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium'>
                        {renderUserActions(user)}
                      </td>
                    </tr>
                    {/* 展开的访问记录详情行 */}
                    {expandedUser === user.username && (
                      <tr
                        key={`${user.username}-access`}
                        className='bg-gray-50 dark:bg-gray-900'
                      >
                        <td colSpan={9} className='px-6 py-4'>
                          {renderUserAccessPanel(user)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 移动端用户卡片列表（md 以下显示，免横向滚动） */}
        <div className='md:hidden border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto p-2 space-y-2'>
          {sortedUsers.map((user) => {
            const logs = accessData[user.username]?.logs || [];
            const lastOnline =
              logs.length === 0
                ? '-'
                : formatAccessTime(logs[0].last_active || logs[0].login_time);
            return (
              <div
                key={user.username}
                className='bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium text-gray-900 dark:text-gray-100 break-all'>
                    {user.username}
                  </span>
                  {renderRoleBadge(user)}
                  {renderStatusBadge(user)}
                  {renderPanBadge(user)}
                </div>
                <div className='mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5'>
                  <span>
                    时长{' '}
                    {formatUsageDuration(
                      accessData[user.username]?.usage_total || 0
                    )}
                  </span>
                  <span>上线 {lastOnline}</span>
                  <span className='font-mono'>
                    IP {accessData[user.username]?.logs?.[0]?.ip || '-'}
                  </span>
                </div>
                <div className='mt-2.5'>{renderUserActions(user)}</div>
                {expandedUser === user.username && (
                  <div className='mt-3 pt-3 border-t border-gray-200 dark:border-gray-700'>
                    {renderUserAccessPanel(user)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// 视频源配置组件
const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  // 测速结果（仅存于内存，刷新即清空）
  const [probeResults, setProbeResults] = useState<
    Record<string, SourceProbeResult>
  >({});
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [probingAll, setProbingAll] = useState(false);
  const [probeProgress, setProbeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [onlySlow, setOnlySlow] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callSourceApi({ action, key }).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    callSourceApi({ action: 'delete', key }).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
    })
      .then(() => {
        setNewSource({
          name: '',
          key: '',
          api: '',
          detail: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失败', 'add', newSource);
      });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    callSourceApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // ---------- 测速 ----------
  const probe = async (keys?: string[]) => {
    try {
      const resp = await fetch('/api/admin/source/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys && keys.length ? { keys } : {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || `测速失败: ${resp.status}`);
      }
      const list: SourceProbeResult[] = data.results || [];
      setProbeResults((prev) => {
        const next = { ...prev };
        list.forEach((r) => {
          next[r.key] = r;
        });
        return next;
      });
      return list;
    } catch (err) {
      showError(err instanceof Error ? err.message : '测速失败');
      return [];
    }
  };

  const handleProbeOne = async (key: string) => {
    if (probingAll || probingKey) return;
    setProbingKey(key);
    await probe([key]);
    setProbingKey(null);
  };

  const handleProbeAll = async () => {
    if (probingAll || probingKey) return;
    const keys = sources.filter((s) => !s.disabled).map((s) => s.key);
    if (keys.length === 0) {
      showError('没有启用中的视频源可测速');
      return;
    }
    setProbingAll(true);
    // 服务端按 4 并发执行，这里按批次推进进度提示
    const chunk = 4;
    const merged: SourceProbeResult[] = [];
    setProbeProgress({ done: 0, total: keys.length });
    for (let i = 0; i < keys.length; i += chunk) {
      const part = await probe(keys.slice(i, i + chunk));
      merged.push(...part);
      setProbeProgress({
        done: Math.min(i + chunk, keys.length),
        total: keys.length,
      });
    }
    setProbeProgress(null);
    setProbingAll(false);
    // 自动筛出慢源，省得用户自己找
    const slow = merged.filter((r) => isSlowResult(r));
    if (slow.length > 0 && slow.length < keys.length) {
      setOnlySlow(true);
    }
  };

  /** 延迟是否属于「该处理」的档位（0 结果不算慢，可能是该关键词没有片源） */
  const isSlowResult = (r?: SourceProbeResult) => {
    if (!r) return false;
    if (!r.ok) return true;
    return r.ms !== null && r.ms >= 1000;
  };

  const latencyClass = (r: SourceProbeResult) => {
    if (!r.ok) return 'text-red-600 dark:text-red-400';
    if (r.count === 0) return 'text-amber-600 dark:text-amber-400';
    const ms = r.ms ?? 0;
    if (ms < 300) return 'text-green-600 dark:text-green-400';
    if (ms < 1000) return 'text-amber-600 dark:text-amber-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const latencyText = (r: SourceProbeResult) => {
    if (!r.ok) return r.error || '失败';
    if (r.count === 0) return `${r.ms}ms · 0条`;
    return `${r.ms}ms · ${r.count}条`;
  };

  /** 延迟单元格（桌面表格） */
  const LatencyCell = ({ source }: { source: DataSource }) => {
    const result = probeResults[source.key];
    const isProbing = probingKey === source.key || probingAll;
    if (!result) {
      return (
        <button
          onClick={() => handleProbeOne(source.key)}
          disabled={isProbing || !!source.disabled}
          title={source.disabled ? '已禁用，不参与测速' : '测试该源响应速度'}
          className='px-2 py-1 rounded-md text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors'
        >
          {probingKey === source.key ? '…' : '测速'}
        </button>
      );
    }
    return (
      <button
        onClick={() => handleProbeOne(source.key)}
        disabled={isProbing}
        title={result.ok ? '点击重新测速' : result.error || ''}
        className={`px-2 py-1 rounded-md text-xs font-medium hover:underline ${latencyClass(
          result
        )}`}
      >
        {probingKey === source.key ? '测速中…' : latencyText(result)}
      </button>
    );
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key, disabled: onlySlow });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[8rem] truncate'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm'>
          <LatencyCell source={source} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !source.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  // 移动端可拖拽卡片封装 (dnd-kit)
  const DraggableCard = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key, disabled: onlySlow });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;
    return (
      <div
        ref={setNodeRef}
        style={style}
        className='bg-gray-50/80 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700 p-3 select-none'
      >
        <div className='flex items-center gap-2'>
          <span
            className='cursor-grab text-gray-400 shrink-0'
            style={{ touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </span>
          <span className='flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
            {source.name}
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </div>
        <div className='mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400 min-w-0'>
          <div className='truncate'>Key：{source.key}</div>
          <div className='truncate' title={source.api}>
            API：{source.api}
          </div>
          {source.detail && (
            <div className='truncate' title={source.detail}>
              Detail：{source.detail}
            </div>
          )}
          <div className='truncate'>
            延迟：
            {probeResults[source.key] ? (
              <span className={latencyClass(probeResults[source.key])}>
                {latencyText(probeResults[source.key])}
              </span>
            ) : (
              <span className='text-gray-400'>未测</span>
            )}
          </div>
        </div>
        <div className='flex flex-wrap gap-2 mt-2.5'>
          <button
            onClick={() => handleProbeOne(source.key)}
            disabled={probingAll || !!probingKey || !!source.disabled}
            className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-40 transition-colors'
          >
            {probingKey === source.key
              ? '测速中…'
              : probeResults[source.key]
              ? '重测'
              : '测速'}
          </button>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium ${
              !source.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          )}
        </div>
      </div>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  // 筛选仅作用于显示层，不改动真实排序（拖拽顺序会持久化，不能被过滤影响）
  const shownSources = onlySlow
    ? sources.filter((s) => isSlowResult(probeResults[s.key]))
    : sources;

  return (
    <div className='space-y-6'>
      {/* 添加视频源表单 */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
          <span className='ml-2 text-xs font-normal text-gray-400'>
            {shownSources.length}/{sources.length} 个
          </span>
        </h4>
        <div className='flex flex-wrap items-center gap-2'>
          {(probeProgress || probingAll) && (
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              {probeProgress
                ? `测速中 ${probeProgress.done}/${probeProgress.total}`
                : '测速中…'}
            </span>
          )}
          {Object.keys(probeResults).length > 0 && (
            <label className='inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={onlySlow}
                onChange={(e) => setOnlySlow(e.target.checked)}
                className='rounded border-gray-300 dark:border-gray-600'
              />
              只看慢源/异常
            </label>
          )}
          <button
            onClick={handleProbeAll}
            disabled={probingAll || !!probingKey}
            className='inline-flex items-center px-3 py-1 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            {probingAll ? (
              <Loader2 size={14} className='mr-1 animate-spin' />
            ) : (
              <RefreshCw size={14} className='mr-1' />
            )}
            全部测速
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
          >
            {showAddForm ? '取消' : '添加视频源'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格（桌面端） */}
      <div className='hidden md:block border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              <th className='w-8' />
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Key
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                API 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Detail 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                延迟
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {shownSources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* 视频源卡片列表（移动端，可拖拽排序） */}
      <div className='md:hidden border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto p-2 space-y-2'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={sources.map((s) => s.key)}
            strategy={verticalListSortingStrategy}
          >
            {shownSources.map((source) => (
              <DraggableCard key={source.key} source={source} />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 分类配置组件
const CategoryConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<CustomCategory>({
    name: '',
    type: 'movie',
    query: '',
    disabled: false,
    from: 'config',
  });

  // 检测存储类型是否为 d1 或 upstash
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.CustomCategories) {
      setCategories(config.CustomCategories);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callCategoryApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (query: string, type: 'movie' | 'tv') => {
    const target = categories.find((c) => c.query === query && c.type === type);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callCategoryApi({ action, query, type }).catch(() => {
      console.error('操作失败', action, query, type);
    });
  };

  const handleDelete = (query: string, type: 'movie' | 'tv') => {
    callCategoryApi({ action: 'delete', query, type }).catch(() => {
      console.error('操作失败', 'delete', query, type);
    });
  };

  const handleAddCategory = () => {
    if (!newCategory.name || !newCategory.query) return;
    callCategoryApi({
      action: 'add',
      name: newCategory.name,
      type: newCategory.type,
      query: newCategory.query,
    })
      .then(() => {
        setNewCategory({
          name: '',
          type: 'movie',
          query: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失败', 'add', newCategory);
      });
  };

  const handleDragEnd = (event: any) => {
    if (isD1Storage || isUpstashStorage) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === active.id
    );
    const newIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === over.id
    );
    setCategories((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = categories.map((c) => `${c.query}:${c.type}`);
    callCategoryApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ category }: { category: CustomCategory }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: `${category.query}:${category.type}` });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className={`px-2 py-4 ${
            isD1Storage || isUpstashStorage
              ? 'text-gray-200'
              : 'cursor-grab text-gray-400'
          }`}
          style={{ touchAction: 'none' }}
          {...(isD1Storage || isUpstashStorage
            ? {}
            : { ...attributes, ...listeners })}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {category.name || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              category.type === 'movie'
                ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
            }`}
          >
            {category.type === 'movie' ? '电影' : '电视剧'}
          </span>
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={category.query}
        >
          {category.query}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !category.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!category.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              handleToggleEnable(category.query, category.type)
            }
            disabled={isD1Storage || isUpstashStorage}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              isD1Storage || isUpstashStorage
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : !category.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!category.disabled ? '禁用' : '启用'}
          </button>
          {category.from !== 'config' && !isD1Storage && !isUpstashStorage && (
            <button
              onClick={() => handleDelete(category.query, category.type)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  // 移动端可拖拽卡片封装 (dnd-kit)
  const DraggableCard = ({ category }: { category: CustomCategory }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: `${category.query}:${category.type}` });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;
    return (
      <div
        ref={setNodeRef}
        style={style}
        className='bg-gray-50/80 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700 p-3 select-none'
      >
        <div className='flex items-center gap-2'>
          <span
            className={`shrink-0 ${
              isD1Storage || isUpstashStorage
                ? 'text-gray-400/40'
                : 'cursor-grab text-gray-400'
            }`}
            style={{ touchAction: 'none' }}
            {...(isD1Storage || isUpstashStorage
              ? {}
              : { ...attributes, ...listeners })}
          >
            <GripVertical size={16} />
          </span>
          <span className='flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
            {category.name || '-'}
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${
              category.type === 'movie'
                ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
            }`}
          >
            {category.type === 'movie' ? '电影' : '电视剧'}
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${
              !category.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!category.disabled ? '启用中' : '已禁用'}
          </span>
        </div>
        <div
          className='mt-2 text-xs text-gray-500 dark:text-gray-400 truncate'
          title={category.query}
        >
          关键词：{category.query}
        </div>
        <div className='flex flex-wrap gap-2 mt-2.5'>
          <button
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              handleToggleEnable(category.query, category.type)
            }
            disabled={isD1Storage || isUpstashStorage}
            className={`inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium ${
              isD1Storage || isUpstashStorage
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : !category.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!category.disabled ? '禁用' : '启用'}
          </button>
          {category.from !== 'config' && !isD1Storage && !isUpstashStorage && (
            <button
              onClick={() => handleDelete(category.query, category.type)}
              className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          )}
        </div>
      </div>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加分类表单 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          自定义分类列表
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过配置文件修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过配置文件修改)
            </span>
          )}
        </h4>
        <button
          onClick={() =>
            !isD1Storage && !isUpstashStorage && setShowAddForm(!showAddForm)
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`px-3 py-1 text-sm rounded-lg transition-colors ${
            isD1Storage || isUpstashStorage
              ? 'bg-gray-400 cursor-not-allowed text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {showAddForm ? '取消' : '添加分类'}
        </button>
      </div>

      {showAddForm && !isD1Storage && !isUpstashStorage && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='分类名称'
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <select
              value={newCategory.type}
              onChange={(e) =>
                setNewCategory((prev) => ({
                  ...prev,
                  type: e.target.value as 'movie' | 'tv',
                }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            >
              <option value='movie'>电影</option>
              <option value='tv'>电视剧</option>
            </select>
            <input
              type='text'
              placeholder='搜索关键词'
              value={newCategory.query}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, query: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddCategory}
              disabled={!newCategory.name || !newCategory.query}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 分类表格（桌面端） */}
      <div className='hidden md:block border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              <th className='w-8' />
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                分类名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                类型
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                搜索关键词
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={isD1Storage || isUpstashStorage ? [] : sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={categories.map((c) => `${c.query}:${c.type}`)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {categories.map((category) => (
                  <DraggableRow
                    key={`${category.query}:${category.type}`}
                    category={category}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* 分类卡片列表（移动端，可拖拽排序） */}
      <div className='md:hidden border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto p-2 space-y-2'>
        <DndContext
          sensors={isD1Storage || isUpstashStorage ? [] : sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={categories.map((c) => `${c.query}:${c.type}`)}
            strategy={verticalListSortingStrategy}
          >
            {categories.map((category) => (
              <DraggableCard
                key={`${category.query}:${category.type}`}
                category={category}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && !isD1Storage && !isUpstashStorage && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 新增站点配置组件
const SiteConfigComponent = ({ config }: { config: AdminConfig | null }) => {
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    ImageProxy: '',
    DoubanProxy: '',
    DisableYellowFilter: false,
  });
  // 保存状态
  const [saving, setSaving] = useState(false);

  // 检测存储类型是否为 d1 或 upstash
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        ImageProxy: config.SiteConfig.ImageProxy || '',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter || false,
      });
    }
  }, [config]);

  // 保存站点配置
  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      showSuccess('保存成功, 请刷新页面');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点名称
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 站点公告 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点公告
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          rows={3}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 图片代理 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          图片代理前缀
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://imageproxy.example.com/?url='
          value={siteSettings.ImageProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              ImageProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          用于代理图片访问，解决跨域或访问限制问题。留空则不使用代理。
        </p>
      </div>

      {/* 豆瓣代理设置 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          豆瓣代理地址
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://proxy.example.com/fetch?url='
          value={siteSettings.DoubanProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              DoubanProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          用于代理豆瓣数据访问，解决跨域或访问限制问题。留空则使用服务端API。
        </p>
      </div>

      {/* 禁用黄色过滤器 */}
      <div>
        <div className='flex items-center justify-between'>
          <label
            className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
              isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
          >
            禁用黄色过滤器
            {isD1Storage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (D1 环境下请通过环境变量修改)
              </span>
            )}
            {isUpstashStorage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (Upstash 环境下请通过环境变量修改)
              </span>
            )}
          </label>
          <button
            type='button'
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            disabled={isD1Storage || isUpstashStorage}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.DisableYellowFilter
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
            } ${
              isD1Storage || isUpstashStorage
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                siteSettings.DisableYellowFilter
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          禁用黄色内容的过滤功能，允许显示所有内容。
        </p>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 ${
            saving
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};

// ============ 系统更新(仅站长可见) ============

interface UpdateCapabilities {
  updateLatest: boolean;
  switchVersion: boolean;
  channel: 'watchtower' | 'vercel' | 'cloudflare' | 'docker' | null;
}

interface UpdateCheckResult {
  platform: 'docker' | 'vercel' | 'cloudflare' | 'unknown';
  capabilities: UpdateCapabilities;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean | null;
  manualGuide?: string;
}

interface UpdateVersionEntry {
  sha: string;
  short: string;
  date: string;
  tag: string | null;
  isCurrent: boolean;
  isLatest: boolean;
  count: number;
  commits: { short: string; message: string; date: string }[];
}

// YYYYMMDDHHMMSS -> 可读时间
const formatVersionTime = (v: string) =>
  v.length === 14
    ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)} ${v.slice(
        8,
        10
      )}:${v.slice(10, 12)}`
    : v;

const formatRelativeTime = (dateStr: string) => {
  const diff = Date.now() - Date.parse(dateStr);
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}天前`;
  return `${Math.floor(day / 30)}个月前`;
};

const genRandomToken = () => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          showError('复制失败,请手动选择文本复制');
        }
      }}
      className='inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors'
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? '已复制' : '复制'}
    </button>
  );
};

const SnippetBlock = ({ text, label }: { text: string; label?: string }) => (
  <div className='mb-3'>
    {label && (
      <div className='flex items-center justify-between mb-1'>
        <span className='text-xs text-gray-500 dark:text-gray-400'>
          {label}
        </span>
        <CopyButton text={text} />
      </div>
    )}
    <pre className='whitespace-pre-wrap font-mono text-xs bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 rounded-lg p-3 overflow-x-auto'>
      {text}
    </pre>
  </div>
);

// 配置引导(按平台显示对应教程,文案与 README 同源)
const GUIDE_PLATFORMS = [
  { key: 'docker', label: 'Docker' },
  { key: 'vercel', label: 'Vercel' },
  { key: 'cloudflare', label: 'Cloudflare' },
] as const;

const UpdateGuide = ({
  platform,
  onRecheck,
}: {
  platform: 'docker' | 'vercel' | 'cloudflare' | 'unknown';
  onRecheck: () => void;
}) => {
  const [selected, setSelected] = useState<
    'docker' | 'vercel' | 'cloudflare' | 'unknown'
  >(platform === 'unknown' ? 'docker' : platform);
  const [token, setToken] = useState(() => genRandomToken());

  const dockerCompose = `services 里新增 watchtower 服务(与应用同网络):

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    environment:
      - WATCHTOWER_HTTP_API_ENABLE=true
      - WATCHTOWER_HTTP_API_TOKEN=${token}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock`;

  const dockerEnv = `应用容器新增环境变量:

  WATCHTOWER_API_URL=http://watchtower:8080
  WATCHTOWER_API_TOKEN=${token}`;

  const dockerSock = `可选 - 支持页面切换历史版本(应用容器添加挂载):

  volumes:
    - /var/run/docker.sock:/var/run/docker.sock

  ⚠️ socket 等于宿主机 root 权限,不挂载不影响"更新到最新"`;

  const vercelSteps = `1. Vercel 项目 → Settings → Git → Deploy Hooks → Create Hook
2. 复制生成的 Hook URL
3. Settings → Environment Variables 添加:
   VERCEL_DEPLOY_HOOK_URL = 刚才的 URL
4. 重新部署一次使环境变量生效`;

  const cfSteps = `1. Pages 项目 → Settings → Webhooks → Add Deploy Hook
2. 复制生成的 Hook URL
3. Settings → Environment variables 添加:
   CF_PAGES_DEPLOY_HOOK_URL = 刚才的 URL
4. 重新部署一次生效`;

  return (
    <div className='mt-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4'>
      <div className='text-sm font-medium text-gray-800 dark:text-gray-200 mb-3'>
        ⚙ 如何启用一键更新
      </div>
      <div className='flex items-center gap-2 mb-3'>
        {GUIDE_PLATFORMS.map((p) => (
          <button
            key={p.key}
            onClick={() => setSelected(p.key)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              selected === p.key
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {p.label}
          </button>
        ))}
        {selected === 'docker' && (
          <button
            onClick={() => setToken(genRandomToken())}
            className='ml-auto inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 transition-colors'
          >
            <RefreshCw size={12} className='mr-1' />
            重新生成 Token
          </button>
        )}
      </div>

      {selected === 'docker' && (
        <>
          <SnippetBlock text={dockerCompose} label='① docker-compose.yml' />
          <SnippetBlock text={dockerEnv} label='② 应用环境变量' />
          <SnippetBlock text={dockerSock} label='③ 历史版本切换(可选)' />
        </>
      )}
      {selected === 'vercel' && (
        <SnippetBlock text={vercelSteps} label='配置步骤' />
      )}
      {selected === 'cloudflare' && (
        <SnippetBlock text={cfSteps} label='配置步骤' />
      )}

      <div className='flex items-center justify-between mt-2'>
        <span className='text-xs text-gray-400 dark:text-gray-500'>
          配置后需重启/重新部署生效
        </span>
        <button
          onClick={onRecheck}
          className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors'
        >
          我已配置完成,重新检测
        </button>
      </div>
    </div>
  );
};

// 私人网盘配置组件
const PanConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [panSettings, setPanSettings] = useState<PanConfig>({
    enabled: false,
    openlistUrl: '',
    openlistToken: '',
    rootPath: '/',
  });
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config?.PanConfig) {
      setPanSettings({
        enabled: Boolean(config.PanConfig.enabled),
        openlistUrl: config.PanConfig.openlistUrl || '',
        openlistToken: config.PanConfig.openlistToken || '',
        rootPath: config.PanConfig.rootPath || '/',
      });
    }
  }, [config]);

  const handleTestConnection = async () => {
    if (!panSettings.openlistUrl.trim()) {
      showError('请先填写 OpenList / AList 接口地址');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/pan/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panSettings),
      });
      const data = await res.json();
      setTestResult({
        ok: data.ok,
        message: data.message || (data.ok ? '连接成功' : '连接失败'),
      });
      if (data.ok) {
        showSuccess(data.message || '连接测试成功！');
      } else {
        showError(data.message || '连接失败，请检查服务地址与Token');
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || '测试请求发送失败',
      });
      showError(err?.message || '网络异常');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panSettings),
      });
      const data = await res.json();
      if (data.ok) {
        showSuccess('网盘配置保存成功');
        await refreshConfig();
      } else {
        showError(data.error || '保存失败');
      }
    } catch (err: any) {
      showError(err?.message || '保存异常');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className='space-y-6'>
      <div className='bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4'>
        {/* 功能开关 */}
        <div className='flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/60'>
          <div>
            <label className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              启用私人网盘影库
            </label>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
              对接自建 OpenList / AList v3
              API。开启且授权后将在导航栏显示「网盘」入口。
            </p>
          </div>
          <input
            type='checkbox'
            checked={panSettings.enabled}
            onChange={(e) =>
              setPanSettings((prev) => ({ ...prev, enabled: e.target.checked }))
            }
            className='h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-700'
          />
        </div>

        {/* 接口地址 */}
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            OpenList / AList 接口地址 <span className='text-red-500'>*</span>
          </label>
          <input
            type='text'
            placeholder='例如 http://openlist:5244 或 http://127.0.0.1:5244'
            value={panSettings.openlistUrl}
            onChange={(e) =>
              setPanSettings((prev) => ({
                ...prev,
                openlistUrl: e.target.value,
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm'
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            可填写 Docker 内网名（如
            http://openlist:5244）、本机地址或远程域名。严禁下发给普通用户前端。
          </p>
        </div>

        {/* API Token */}
        <div>
          <div className='flex items-center justify-between mb-1'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              API 访问令牌 (Token)
            </label>
            <button
              type='button'
              onClick={() => setShowToken(!showToken)}
              className='text-xs text-green-600 hover:text-green-700 dark:text-green-400'
            >
              {showToken ? '隐藏' : '显示'}
            </button>
          </div>
          <input
            type={showToken ? 'text' : 'password'}
            placeholder='若 AList 开启了认证请输入 Token（留空则不覆盖已保存的Token）'
            value={panSettings.openlistToken}
            onChange={(e) =>
              setPanSettings((prev) => ({
                ...prev,
                openlistToken: e.target.value,
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm font-mono'
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            可在 AList
            管理后台「设置」-「其他」中查看或生成。此令牌由服务端严格保密。
          </p>
        </div>

        {/* 根目录路径 */}
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            挂载根目录路径
          </label>
          <input
            type='text'
            placeholder='例如 / 或 /夸克影视'
            value={panSettings.rootPath}
            onChange={(e) =>
              setPanSettings((prev) => ({ ...prev, rootPath: e.target.value }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm'
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            限制用户仅能在此目录下浏览与播放视频，后端强校验防止穿越。根目录填「/」表示可访问全盘。
          </p>
        </div>

        {/* 测试连接反馈面板 */}
        {testResult && (
          <div
            className={`p-3 rounded-md text-xs sm:text-sm ${
              testResult.ok
                ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {testResult.message}
          </div>
        )}

        {/* 302 客户端直连配置指南 */}
        <div className='p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/60 rounded-xl text-xs sm:text-sm text-emerald-900 dark:text-emerald-200 space-y-1.5'>
          <div className='font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300'>
            <Info className='w-4 h-4 shrink-0' />
            网盘 302 客户端直连配置指南（0 服务器流量消耗）
          </div>
          <p className='text-gray-600 dark:text-gray-300 leading-relaxed text-xs'>
            为确保用户拉取视频流时不消耗你服务器/NAS的上行带宽，请在 AList
            管理后台「存储」中将挂载的网盘配置为 302 直连：
            <br />
            1. <b>关闭「Web 代理 (Web Proxy)」</b>（不勾选）
            <br />
            2. <b>「WebDAV 策略」选择为「302 重定向 (302_redirect)」</b>
            <br />
            配置后，NovaTV
            播放器和外部播放器（PotPlayer/VLC等）将直接对接网盘官方
            CDN，跑满用户宽带，且 0 经过服务器中转。
          </p>
        </div>

        {/* 操作按钮区 */}
        <div className='flex flex-wrap items-center gap-3 pt-2'>
          <button
            type='button'
            disabled={testing}
            onClick={handleTestConnection}
            className='inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none transition-colors disabled:opacity-50'
          >
            {testing ? (
              <>
                <Loader2 className='animate-spin -ml-1 mr-2 h-4 w-4' />
                正在测试连接...
              </>
            ) : (
              '测试连接与目录可读性'
            )}
          </button>
          <button
            type='submit'
            disabled={saving}
            className='inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none transition-colors disabled:opacity-50'
          >
            {saving ? (
              <>
                <Loader2 className='animate-spin -ml-1 mr-2 h-4 w-4' />
                保存中...
              </>
            ) : (
              '保存网盘配置'
            )}
          </button>
        </div>
      </div>
    </form>
  );
};

const SystemUpdateTab = () => {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(
    null
  );
  const [checkError, setCheckError] = useState<string | null>(null);
  const [versions, setVersions] = useState<UpdateVersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const doCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch('/api/admin/update?action=check');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '检查失败');
      setCheckResult(data as UpdateCheckResult);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : '检查更新失败');
    } finally {
      setChecking(false);
    }
  }, []);

  const doLoadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const res = await fetch('/api/admin/update?action=changelog');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取版本历史失败');
      const list = (data.versions || []) as UpdateVersionEntry[];
      setVersions(list);
      // 最新一版默认展开
      if (list.length) setExpandedVersion(list[0].sha);
    } catch (e) {
      console.error('获取版本历史失败:', e);
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    doCheck();
    doLoadVersions();
  }, [doCheck, doLoadVersions]);

  // 触发更新后轮询版本号,变化即刷新页面
  const pollForRestart = (baseline: string, actionLabel: string) => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setCheckError(null);
    setPolling(true);
    setPollMsg(`${actionLabel}已触发,站点将短暂重启,正在等待新版本上线…`);
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/api/admin/update?action=check', {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.currentVersion && data.currentVersion !== baseline) {
            clearInterval(timer);
            pollTimerRef.current = null;
            setPolling(false);
            setPollMsg(null);
            showSuccess('更新完成,即将刷新页面');
            setTimeout(() => window.location.reload(), 1200);
            return;
          }
        }
      } catch {
        /* 重启期间请求失败属正常,继续轮询 */
      }
      if (tries >= 36) {
        clearInterval(timer);
        pollTimerRef.current = null;
        setPolling(false);
        setPollMsg('迟迟未检测到新版本上线,请检查更新通道日志后手动刷新');
      }
    }, 5000);
    pollTimerRef.current = timer;
  };

  const handleUpdateLatest = async () => {
    if (!checkResult?.capabilities.updateLatest) return;
    const { isConfirmed } = await styledSwal.fire({
      title: '更新到最新版本',
      text: '站点将短暂重启(通常 1 分钟内),确认现在更新吗?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '立即更新',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;
    setUpdating('latest');
    try {
      const res = await fetch('/api/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateLatest' }),
      });
      // 容错处理：若上游反代在容器重启期间返回 502/503/504，说明容器正在重启，转入轮询
      if ([502, 503, 504].includes(res.status)) {
        pollForRestart(checkResult.currentVersion, '更新');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = String(data.error || '');
        if (/502|503|504|bad gateway|gateway/i.test(errMsg)) {
          pollForRestart(checkResult.currentVersion, '更新');
          return;
        }
        throw new Error(errMsg || `更新失败 (${res.status})`);
      }
      pollForRestart(checkResult.currentVersion, '更新');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新失败';
      // 容错处理：若因容器中途重启或拉取镜像耗时触发超时、网络中断或网关断开，说明更新其实已经在进行中，自动转入探测轮询
      if (
        /timeout|aborted|failed to fetch|networkerror|load failed|502|503|504|bad gateway|gateway/i.test(
          msg
        )
      ) {
        pollForRestart(checkResult.currentVersion, '更新');
      } else {
        showError(msg);
      }
    } finally {
      setUpdating(null);
    }
  };

  const handleSwitchVersion = async (v: UpdateVersionEntry) => {
    if (!checkResult?.capabilities.switchVersion || !v.tag) return;
    const { isConfirmed } = await styledSwal.fire({
      title: `切换到 ${v.tag}`,
      text: '将拉取该版本镜像并重建容器,站点会短暂重启。切回旧版本后可随时再更新到最新。',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认切换',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;
    setUpdating(v.tag);
    try {
      const res = await fetch('/api/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateVersion', version: v.tag }),
      });
      // 容错处理：若上游反代在容器重启期间返回 502/503/504，说明容器正在重启，转入轮询
      if ([502, 503, 504].includes(res.status)) {
        pollForRestart(checkResult.currentVersion, '版本切换');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = String(data.error || '');
        if (/502|503|504|bad gateway|gateway/i.test(errMsg)) {
          pollForRestart(checkResult.currentVersion, '版本切换');
          return;
        }
        throw new Error(errMsg || `切换失败 (${res.status})`);
      }
      pollForRestart(checkResult.currentVersion, '版本切换');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '切换失败';
      if (
        /timeout|aborted|failed to fetch|networkerror|load failed|502|503|504|bad gateway|gateway/i.test(
          msg
        )
      ) {
        pollForRestart(checkResult.currentVersion, '版本切换');
      } else {
        showError(msg);
      }
    } finally {
      setUpdating(null);
    }
  };

  const caps = checkResult?.capabilities;
  const guideNeeded =
    checkResult &&
    (!caps?.updateLatest ||
      (checkResult.platform === 'docker' && !caps?.switchVersion));

  const statusBadge = () => {
    if (checking)
      return (
        <span className='inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'>
          <Loader2 size={12} className='animate-spin' />
          检查中
        </span>
      );
    if (checkError)
      return (
        <span className='px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'>
          检查失败
        </span>
      );
    if (checkResult?.hasUpdate)
      return (
        <span className='px-2.5 py-1 rounded-full text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
          有新版本 {checkResult.latestVersion}
        </span>
      );
    if (checkResult)
      return (
        <span className='px-2.5 py-1 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'>
          已是最新
        </span>
      );
    return null;
  };

  return (
    <div className='space-y-4'>
      {/* 版本状态卡片 */}
      <div className='rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
          <div>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              当前版本
            </div>
            <div className='text-xs text-gray-500 dark:text-gray-400 font-mono mt-1'>
              {checkResult
                ? formatVersionTime(checkResult.currentVersion)
                : '加载中…'}
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {statusBadge()}
            <button
              onClick={doCheck}
              disabled={checking}
              className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50 transition-colors'
            >
              <RefreshCw
                size={12}
                className={`mr-1 ${checking ? 'animate-spin' : ''}`}
              />
              检查更新
            </button>
            <button
              onClick={handleUpdateLatest}
              disabled={!caps?.updateLatest || updating !== null || polling}
              className='inline-flex items-center px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              title={
                caps?.updateLatest
                  ? ''
                  : '未配置更新通道,请展开下方「如何启用一键更新」'
              }
            >
              {updating === 'latest' ? (
                <Loader2 size={12} className='mr-1 animate-spin' />
              ) : null}
              更新到最新
            </button>
          </div>
        </div>

        {(pollMsg || checkError) && (
          <div
            className={`mt-3 text-xs px-3 py-2 rounded-md ${
              checkError
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
            }`}
          >
            {checkError || pollMsg}
          </div>
        )}

        {checkResult && guideNeeded && (
          <>
            {!showGuide ? (
              <button
                onClick={() => setShowGuide(true)}
                className='mt-3 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 underline underline-offset-2 transition-colors'
              >
                ⚙ 如何启用一键更新?
              </button>
            ) : (
              <UpdateGuide
                platform={checkResult.platform}
                onRecheck={() => {
                  doCheck();
                  setShowGuide(false);
                }}
              />
            )}
          </>
        )}
      </div>

      {/* 版本历史 */}
      <div>
        <div className='text-sm font-medium text-gray-800 dark:text-gray-200 mb-2'>
          版本历史
          <span className='ml-2 text-xs font-normal text-gray-400'>
            最多展示最近 10 个已构建版本
          </span>
        </div>
        {loadingVersions ? (
          <div className='flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 px-3 py-3'>
            <Loader2 size={14} className='animate-spin' />
            正在获取版本历史…
          </div>
        ) : versions.length === 0 ? (
          <div className='text-xs text-gray-500 dark:text-gray-400 px-3 py-3'>
            暂无版本历史(镜像仍在构建或 GitHub 接口受限)
          </div>
        ) : (
          <div className='space-y-2'>
            {versions.map((v) => (
              <div
                key={v.sha}
                className='rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden'
              >
                <button
                  onClick={() =>
                    setExpandedVersion(expandedVersion === v.sha ? null : v.sha)
                  }
                  className='w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors'
                >
                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-gray-400 transition-transform ${
                      expandedVersion === v.sha ? 'rotate-180' : ''
                    }`}
                  />
                  <span className='font-mono text-xs text-gray-700 dark:text-gray-300'>
                    {v.tag}
                  </span>
                  <span className='text-xs text-gray-400 dark:text-gray-500'>
                    {formatRelativeTime(v.date)}
                  </span>
                  <span className='px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'>
                    {v.count} 项更新
                  </span>
                  <span className='ml-auto flex items-center gap-1.5'>
                    {v.isCurrent && (
                      <span className='px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'>
                        当前版本
                      </span>
                    )}
                    {v.isLatest && (
                      <span className='px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
                        最新
                      </span>
                    )}
                  </span>
                </button>
                {expandedVersion === v.sha && (
                  <div className='px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'>
                    {v.commits.map((c) => (
                      <div
                        key={c.short}
                        className='flex gap-2 text-xs py-1 text-gray-600 dark:text-gray-300'
                      >
                        <span className='font-mono text-gray-400 dark:text-gray-500 shrink-0'>
                          {c.short}
                        </span>
                        <span>{c.message}</span>
                      </div>
                    ))}
                    <div className='mt-2 flex items-center gap-2'>
                      {caps?.switchVersion &&
                        v.tag &&
                        !v.isCurrent &&
                        !v.isLatest && (
                          <button
                            onClick={() => handleSwitchVersion(v)}
                            disabled={updating !== null || polling}
                            className='inline-flex items-center px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition-colors'
                          >
                            {updating === v.tag ? (
                              <Loader2
                                size={12}
                                className='mr-1 animate-spin'
                              />
                            ) : null}
                            切换到此版本
                          </button>
                        )}
                      {v.isLatest && checkResult?.hasUpdate && (
                        <span className='text-xs text-gray-400 dark:text-gray-500'>
                          使用上方「更新到最新」按钮升级到此版本
                        </span>
                      )}
                      {v.isCurrent && (
                        <span className='text-xs text-gray-400 dark:text-gray-500'>
                          正在运行此版本
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function AdminPageClient() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    siteConfig: false,
    categoryConfig: false,
    panConfig: false,
    systemUpdate: false,
  });

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`获取配置失败: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取配置失败';
      showError(msg);
      setError(msg);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 新增: 重置配置处理函数
  const handleResetConfig = async () => {
    const { isConfirmed } = await Swal.fire({
      title: '确认重置配置',
      text: '此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      const response = await fetch(`/api/admin/reset`);
      if (!response.ok) {
        throw new Error(`重置失败: ${response.status}`);
      }
      showSuccess('重置成功，请刷新页面！');
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失败');
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    // 错误已通过 SweetAlert2 展示，此处直接返回空
    return null;
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 标题 + 重置配置按钮 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className='px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors'
              >
                重置配置
              </button>
            )}
          </div>

          {/* 站点配置标签 */}
          <CollapsibleTab
            title='站点配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent config={config} />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用户配置标签 */}
            <CollapsibleTab
              title='用户配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>

            {/* 视频源配置标签 */}
            <CollapsibleTab
              title='视频源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 分类配置标签 */}
            <CollapsibleTab
              title='分类配置'
              icon={
                <FolderOpen
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.categoryConfig}
              onToggle={() => toggleTab('categoryConfig')}
            >
              <CategoryConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 私人网盘配置标签 */}
            <CollapsibleTab
              title='私人网盘配置'
              icon={
                <HardDrive
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.panConfig}
              onToggle={() => toggleTab('panConfig')}
            >
              <PanConfigComponent config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 系统更新标签(仅站长) */}
            {role === 'owner' && (
              <CollapsibleTab
                title='系统更新'
                icon={
                  <RefreshCw
                    size={20}
                    className='text-gray-600 dark:text-gray-400'
                  />
                }
                isExpanded={expandedTabs.systemUpdate}
                onToggle={() => toggleTab('systemUpdate')}
              >
                <SystemUpdateTab />
              </CollapsibleTab>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}

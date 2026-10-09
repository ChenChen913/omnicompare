'use client';

/**
 * 多项目域 hook（Step 8）：列表加载 / 切换 / 新建 / 改名 / 状态 / 删除。
 * 从 video-wall.tsx 拆出，行为与提示文案保持不变。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_PROJECT_ID,
  Project,
  ProjectSummary,
  toProjectSummary,
} from '@/lib/types';
import { PREF_PROJECT } from './shared';

export function useProjects(args: {
  /** 内容处理中禁止切换（避免在途请求把旧项目数据写进新项目视图） */
  busy: boolean;
  /** 切换请求（由主组件持有，触发清单重载） */
  requestSwitch: (id: string) => void;
}) {
  const { busy, requestSwitch } = args;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  /** 项目列表加载；同时校正本地持久化的当前项目（被其他会话删除后回落默认） */
  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      const list = (await res.json().catch(() => null)) as ProjectSummary[] | null;
      if (!Array.isArray(list)) return;
      setProjects(list);
      setProjectId((cur) => {
        if (cur !== DEFAULT_PROJECT_ID && !list.some((p) => p.id === cur)) {
          try {
            localStorage.removeItem(PREF_PROJECT);
          } catch {}
          return DEFAULT_PROJECT_ID;
        }
        return cur;
      });
    } catch {
      /* 列表加载失败不阻塞主流程，下次操作重试 */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /** 切换项目：内容处理中禁止切换，避免在途请求把旧项目数据写进新项目视图 */
  const switchProject = useCallback(
    (id: string) => {
      if (id === projectId) return;
      if (busy) {
        toast.warning('内容处理中，请稍后再切换项目', { id: 'project' });
        return;
      }
      try {
        localStorage.setItem(PREF_PROJECT, id);
      } catch {}
      requestSwitch(id);
    },
    [projectId, busy, requestSwitch],
  );

  const createProject = useCallback(async () => {
    if (busy) {
      toast.warning('内容处理中，请稍后再新建项目', { id: 'project' });
      return;
    }
    setProjectBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const p = (await res.json().catch(() => null)) as (Project & { error?: string }) | null;
      if (!res.ok || !p?.id) {
        toast.error(p?.error || '新建项目失败，请重试', { id: 'project' });
        return;
      }
      setProjects((prev) => [...prev, toProjectSummary(p)]);
      setNewName('');
      setCreating(false);
      try {
        localStorage.setItem(PREF_PROJECT, p.id);
      } catch {}
      toast.success(`已创建「${p.name}」并切换`, { id: 'project' });
      requestSwitch(p.id);
    } catch {
      toast.error('新建项目失败，请重试', { id: 'project' });
    } finally {
      setProjectBusy(false);
    }
  }, [newName, busy, requestSwitch]);

  /** 改名 / 状态：乐观更新 + 失败回滚（同 updateSettings 风格） */
  const updateProject = useCallback(
    async (id: string, patch: { name?: string; status?: ProjectSummary['status'] }) => {
      const prevList = projects;
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const p = (await res.json().catch(() => null)) as (ProjectSummary & { error?: string }) | null;
        if (!res.ok || !p?.id) throw new Error(p?.error || '保存失败');
        toast.success(patch.name !== undefined ? '项目已重命名' : '项目状态已更新', { id: 'project' });
      } catch {
        setProjects(prevList);
        toast.error('项目更新失败，请重试', { id: 'project' });
      }
    },
    [projects],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(data?.error || '删除项目失败', { id: 'project' });
          return;
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (id === projectId) {
          try {
            localStorage.removeItem(PREF_PROJECT);
          } catch {}
          requestSwitch(DEFAULT_PROJECT_ID);
        }
        toast.success('项目已删除', { id: 'project' });
      } catch {
        toast.error('删除项目失败', { id: 'project' });
      }
    },
    [projectId, requestSwitch],
  );

  /** 项目已被其他会话删除（清单 404）：清除本地偏好并回落默认项目 */
  const fallbackToDefault = useCallback(() => {
    try {
      localStorage.removeItem(PREF_PROJECT);
    } catch {}
    requestSwitch(DEFAULT_PROJECT_ID);
  }, [requestSwitch]);

  return {
    projects,
    setProjects,
    projectId,
    setProjectId,
    creating,
    setCreating,
    newName,
    setNewName,
    projectBusy,
    renameDraft,
    setRenameDraft,
    refreshProjects,
    switchProject,
    createProject,
    updateProject,
    deleteProject,
    fallbackToDefault,
  };
}

export type ProjectsApi = ReturnType<typeof useProjects>;

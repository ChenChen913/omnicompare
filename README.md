# 视频墙 Video Wall

多视频矩阵展示 H5：自定义视频个数与几行几列，批量上传、填写标题，一键「同时播放」。
A multi-video matrix wall: pick how many videos (1–12) and the row × column layout, batch-upload, add titles, then play them all in sync with one click.

- 在线体验 / Live demo：部署后填写你的地址（本项目默认无鉴权，公网部署请加访问控制）
- 详细文档 / Full docs：[PROJECT.md](./PROJECT.md)

---

## 中文

### 功能特性

- 🧮 **动态数量与矩阵**：1–12 个视频位，任意「行 × 列」组合；质数自动提供补位矩阵；单视频自动满幅
- 📤 **多种上传方式**：点击空位、整页拖拽、一键多选导入；文件数超位自动扩容
- ✍️ **标题介绍**：每个视频下方独立标题框，自动增高、防抖保存、刷新不丢
- ▶️ **同时播放**：统一回到开头后同步起播，全局静音 / 循环开关（状态记忆）
- 💾 **服务端持久化**：视频与清单存服务器，换设备、刷新均不丢；文件流支持 Range 分段播放
- 🛡️ **细节打磨**：缩减位数二次确认、替换上传自动清理旧文件、提示 toast 防叠加、布局切换零抖动

### 快速开始

```bash
bun install        # 或 npm install
bun run dev        # 开发模式 → http://localhost:3000

# 生产
bun run build
bun run start
```

### 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · sonner · 文件系统存储（无需数据库）

### 注意事项

- 项目**无鉴权**，公网部署请在反向代理层加 Basic Auth 等访问控制
- 上传限制：单文件 ≤ 200MB，支持 MP4 / MOV / WebM 等常见格式，最多 12 个视频位
- 视频与清单保存在 `data/` 目录（已 gitignore），备份即复制该目录

---

## English

### Features

- 🧮 **Dynamic count & matrix**: 1–12 slots, any row × column combination; prime counts get padded-matrix options; a single video fills the screen
- 📤 **Multiple upload paths**: click an empty slot, drag files onto the page, or multi-select import; slots auto-expand when needed
- ✍️ **Titles**: per-video title box that auto-grows, saves with debounce, survives refresh
- ▶️ **Play in sync**: all videos rewind then start together; global mute / loop toggles (persisted)
- 💾 **Server persistence**: videos and manifest live on the server; streaming supports HTTP Range requests
- 🛡️ **Polish**: shrink confirmation, old files cleaned on replace, non-stacking toasts, zero jitter when switching layouts

### Quick start

```bash
bun install        # or npm install
bun run dev        # development → http://localhost:3000

# production
bun run build
bun run start
```

### Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · sonner · filesystem storage (no database)

### Notes

- **No authentication** — if you deploy to the public internet, add access control (e.g. Basic Auth) at your reverse proxy
- Upload limits: ≤ 200 MB per file; MP4 / MOV / WebM and other common formats; up to 12 slots
- All state lives in `data/` (gitignored) — backing up is just copying that folder

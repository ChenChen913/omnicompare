# facts.md

> README 的唯一事实来源。A 部分由扫描生成（每条附来源与产生命令），B 部分取自仓库既有文档中作者的原话，未作改写。

## A. 可自动提取的事实

1. **项目类型**：Web 应用（③）+ 自托管服务（④）。依据：`package.json` 有 `next` 与 `scripts`，无 `bin`/`exports`/`main`；有 `Dockerfile` + `docker-compose.yml`。
2. **主语言 / 运行时 / 最低版本**：TypeScript 5 + React 19 + Next.js 16.1.3；Node ≥ 20.9.0。
   - 来源：`node -e "const p=require('./node_modules/next/package.json');console.log(p.version, JSON.stringify(p.engines))"` → `16.1.3 {"node":">=20.9.0"}`
   - `package.json` 原无 `engines`，本次据 Next.js 的实际约束补入 `"node": ">=20.9.0"`。
3. **包管理器**：Bun（仓库含 `bun.lock`，无其他锁文件）。
4. **安装命令**：`bun install`（逐字取自 README 既有内容与本机实跑；`bun install` 实测 787 包、33.6s、exit 0）。
5. **运行命令**（逐字取自 `package.json` scripts）：
   - `bun run dev` — 监听 3000，日志双写终端与 `dev.log`
   - `bun run build` — `next build` + `scripts/copy-standalone.mjs`
   - `bun run start` — 生产模式跑 standalone 产物
6. **检查命令**（逐字取自 `package.json` scripts）：`bun run lint`、`bun run typecheck`。
7. **测试命令**：
   - `node scripts/api-regression-test.mjs` — 零外部依赖，57 项断言
   - `bash scripts/api-adversarial-test.sh`、`bash scripts/api-v2-smoke-test.sh` — 需 curl + jq + python3
8. **仓库规模**：
   - `node -e "..."`（统计 `src` 下 .ts/.tsx/.mjs）→ **33 个文件 / 6318 行**
   - `bun run scripts/find-dead-code.mjs` → **不可达 0 个**
   - API 路由：`src/app/api` 下 16 个 `route.ts`；`bun run build` 输出路由表共 18 条（含 `/` 与 `/_not-found`）
9. **依赖数量**：`node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).length, Object.keys(p.devDependencies).length)"` → **18 / 8**
10. **目录结构**：见 README「项目结构」一节，与 `globals.css` / `PROJECT.md` §3 一致。
11. **主要依赖**（前 10）：
    | 包 | 用途 |
    |---|---|
    | `next` | 框架（App Router，前后端同进程） |
    | `react` / `react-dom` | UI 运行时 |
    | `@dnd-kit/*` | 卡片拖拽排序 |
    | `@radix-ui/react-dialog` / `-dropdown-menu` / `-popover` / `-alert-dialog` / `-slot` | 弹层与菜单（shadcn/ui 底座） |
    | `sonner` | toast |
    | `next-themes` | 暗/亮主题 |
    | `lucide-react` | 图标 |
    | `fflate` | zip 资源包解压（流式） |
    | `clsx` + `tailwind-merge` | 类名合并 |
    | `class-variance-authority` | 组件变体 |
12. **环境变量 / 配置项**（`src/` 内**无任何 `process.env` 读取**，以下全部来自运行脚本与容器配置）：
    | 变量 | 必填 | 默认值 | 说明 | 来源 |
    |---|---|---|---|---|
    | `PORT` | 否 | `3000` | 生产监听端口 | `package.json` start 脚本 `--env PORT=3000`；`Dockerfile` `ENV PORT=3000` |
    | `NODE_ENV` | 否 | `production`（由 start 脚本注入） | 生产模式 | `package.json` start 脚本；`Dockerfile` |
    | `HOSTNAME` | 否 | `0.0.0.0`（容器内） | 监听地址 | `Dockerfile` |
    | `TZ` | 否 | `Asia/Shanghai`（容器内） | 时区 | `docker-compose.yml` |
    | `KEEP` | 否 | `14` | 备份保留份数 | `scripts/backup-data.sh` |
    | `DEST` | 否 | `<仓库>/backups` | 备份输出目录 | `scripts/backup-data.sh` |
13. **公开 API**：v1 视图端点（`/api/videos*`，兼容层）与 v2 端点（`/api/projects*`，新 UI 与二次开发用）；完整表见 `PROJECT.md` §7。
14. **已有文档**：`PROJECT.md`（架构/API/二次开发约束）、`README_EN.md`（英文版）、`ROADMAP.md`、`docs/BLUEPRINT.md`、`docs/LESSONS-LEARNED.md`。
15. **许可证**：MIT，见 `LICENSE`；README 既有「许可证」一节亦声明 MIT。

## B. 需人工补充（取自仓库既有文档中作者原话）

- **一句话描述**：`package.json` 的 `description`（本次新增，61 字符）：OmniCompare（灵动对比）：把多个 AI 模型产出的视频、图片与 HTML 页面放进同一矩阵并行对比的对比工作台。
- **为什么做这个项目**（来源：`docs/BLUEPRINT.md` §1、`PROJECT.md` §1）：
  「把多个 AI 模型 / AI 工具对同一 Prompt 生成的结果放进同一个页面矩阵中并行展示，用于视觉对比与评估。它不是视频网站，不是文件管理器，定位是 AI Benchmark / AI Output Comparison Tool。」
- **目标用户 / 前置知识**（来源：`README.md` 既有正文）：把同一 Prompt 喂给多个模型后，需要横向对比各自产出的视频与 HTML 页面的人；前置知识为会用命令行启动一个 Node 服务。
- **与同类方案的差异**（来源：`PROJECT.md` §1、§4、`README.md`）：
  - 视频、图片、HTML 页面（含 zip 页面包）放进**同一个矩阵**对比，不是单一媒体类型的播放器；
  - **服务端多项目持久化**，换设备打开不丢；
  - 存储只用**文件系统 + JSON 清单**，不引入数据库；
  - HTML 与 SVG 一律经 iframe `sandbox="allow-scripts"` + 服务端 CSP 沙箱双重隔离。
- **已知限制 / 明确不做的事**（来源：`PROJECT.md` §10、`README.md`）：
  - **无鉴权**，公网部署必须自行在反向代理层加 Basic Auth / IP 白名单；
  - 进程内互斥锁**仅单进程有效**，多实例部署会破坏一致性；
  - 上传不支持秒传 / 断点续传；
  - 非静音自动播放会被浏览器拦截，故默认静音。
- **演示素材路径**：⚠️ **仓库中不存在任何截图 / GIF**（`docs/` 下无图片资产，`public/` 仅有 `logo.svg`）。README 未引用任何图片，改用终端实录展示。
- **目标读者画像**：拿到仓库要自己跑起来的使用者，以及要接着改代码的开发者。
- **期望读者读完能做什么**：用 `bun install && bun run dev` 在本地跑起服务、导入内容开始对比；知道公网部署前必须先加访问控制。

## 核对记录

- [x] 所有命令实际执行过（install / dev / build / start / typecheck / lint / 回归测试 / 死代码扫描）
- [x] 所有环境变量来源已标注（`src/` 内无 `process.env`，全部来自脚本与容器配置）
- [x] 目录结构与实际一致
- [x] 无臆造项

# OmniCompare（灵动对比）项目详解

> 本文档面向**后续接手开发的工程师与 AI 编码助手**，目标是让任何人和任何 AI 在 10 分钟内完整理解本项目的结构、运行方式与全部约束。快速上手请看 [README.md](./README.md)（中文）或 [README_EN.md](./README_EN.md)（English）。产品演进蓝图与已确认决策见 [docs/BLUEPRINT.md](./docs/BLUEPRINT.md)，后期方向与任务规划见 [ROADMAP.md](./ROADMAP.md)。

---

## 1. 项目简介

**OmniCompare（灵动对比）** 是一个**多内容并行对比工作台**（AI Output Comparison Tool）：把多个模型 / 工具对同一任务产出的内容——视频、HTML 页面——放进同一个矩阵中并行展示，用于视觉对比与评估。它不是视频网站，也不是文件管理器。

项目由「视频墙 Video Wall」演进而来：前者的服务端持久化、矩阵布局、批量播放、上传链路全部继承，并在此基础上扩展出 HTML 内容类型、Studio/Focus 双模式、暗/亮双主题与多项目存储。适合把同一 Prompt 喂给多个模型后，将各自的视频产出或 HTML 页面放进矩阵里横向对比的场景。

核心能力一览：

- **双类型内容**：视频（MP4 / MOV / WebM 等）+ 单文件自包含 HTML 页面（上传即运行），HTML 经 iframe sandbox + 服务端安全响应头双重隔离
- **动态数量**：内容位数量 1–12 任意切换，单内容时自动满幅展示
- **矩阵布局**：任意「行 × 列」组合（整除矩阵按近方形排序；质数数量自动提供「补空位」矩阵选项）
- **批量导入**：点击空位上传、整页拖拽导入、一键多选导入；文件数超过当前位数时自动扩位并匹配矩阵
- **批量播放控制**：全部播放 / 暂停 / 重新开始 / 循环 / 全局静音，只作用于视频内容
- **标题介绍**：每个内容下方有标题框（通常填模型名），自动增高、防抖保存（600ms），刷新不丢
- **Studio / Focus 双模式**：Studio 完整管理，Focus 极简演示，切换不丢内容、不打断播放
- **暗 / 亮双主题**：暗色默认，全界面语义化配色，一键切换
- **服务端多项目持久化**：内容文件与清单按项目存服务器，刷新页面、换设备打开均不丢失
- **缩减保护**：减少内容位数时，若会移除已有内容，弹出确认框明确告知将删除的数量

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 16（App Router）+ React 19 | 前端页面与 API Routes 同仓同进程 |
| 语言 | TypeScript 5（strict） | 全量类型覆盖 |
| 样式 | Tailwind CSS v4 + shadcn/ui（Radix 封装） | 暗色主题；组件在 `src/components/ui/` |
| 提示 | sonner（toast）+ 自定义 AlertDialog | toast 按通道固定 id 去重，位置 bottom-center |
| 图标 | lucide-react | |
| 存储 | **文件系统 + JSON 清单**（无数据库） | `data/projects/[id]/files/` 存内容文件，`data/projects/[id]/manifest.json` 存索引 |
| 包管理 | Bun（含 `bun.lock`） | npm/pnpm 亦可，但没有 lock 文件 |
| 流媒体 | 原生 `<video>` + 自实现 HTTP Range 206 | 见 `src/app/api/files/[name]/route.ts` |

> 注意：本项目**不使用数据库**（仓库内没有 `prisma/`，也没有 `.env`）。
> Tailwind 走 CSS-first 配置：主题令牌与扫描源都在 `src/app/globals.css`
> （`@theme inline` + `@source`），**没有 `tailwind.config.ts`** —— 别去改一个不存在的文件。

## 3. 目录结构（关键文件地图）

```
src/
├── app/
│   ├── layout.tsx                # 根布局：字体、主题 Provider、全局 Toaster（bottom-center）
│   ├── globals.css               # 主题令牌（@theme inline）、扫描源、no-scrollbar、滚动条槽位常驻
│   ├── page.tsx                  # 首页，仅渲染 <VideoWall />
│   └── api/
│       ├── route.ts              # GET /api 健康探针
│       ├── videos/               # v1 视图（默认项目 / ?project=id）
│       │   ├── route.ts          # GET 清单 / PATCH 标题与单卡比例 / DELETE 单个或全部
│       │   ├── upload/route.ts   # POST 上传（FormData: file + slot）
│       │   ├── layout/route.ts   # PATCH 数量与矩阵（缩减即删内容）
│       │   ├── reorder/route.ts  # PATCH 拖拽排序
│       │   └── settings/route.ts # PATCH 项目级播放与展示设置
│       ├── projects/             # schema v2 接口（新 UI 与二次开发使用）
│       │   ├── route.ts          # GET 列表 / POST 新建
│       │   └── [id]/
│       │       ├── route.ts      # GET / PATCH（改名、状态）/ DELETE（默认项目受保护）
│       │       ├── layout/route.ts
│       │       ├── settings/route.ts
│       │       └── items/
│       │           ├── route.ts          # GET 条目数组
│       │           ├── upload/route.ts   # POST 上传条目（≤ SLOT_MAX 个）
│       │           ├── reorder/route.ts  # PATCH 按 id 批量排序
│       │           └── [itemId]/route.ts # PATCH / DELETE 单条目
│       ├── files/[name]/route.ts           # 内容文件流（Range 206；HTML/SVG 强制沙箱头）
│       └── bundles/[name]/[[...path]]/route.ts # zip 包内资产（HTML/SVG 同样强制沙箱头）
├── components/
│   ├── video/
│   │   ├── video-wall.tsx        # 主组件：顶栏、网格、批量逻辑、多项目、全部 toast
│   │   └── video-card.tsx        # 单格卡片：object-contain、拖拽上传、标题自动增高、iframe 沙箱
│   └── ui/                       # shadcn/ui 基础组件（只保留实际用到的；其余用 CLI 按需再加）
├── hooks/                        # （当前为空：历史 toast 钩子已随死代码清理移除）
└── lib/
    ├── types.ts                  # 前后端共享常量、类型与纯函数（SLOT_MAX、ASPECT_RATIOS、aspectCss…）
    ├── project-store.ts          # schema v2 存储核心：多项目目录、迁移、项目锁、条目操作、zip 解包、文件解析
    ├── video-store.ts            # v1 兼容门面：旧 /api/videos* 语义适配到默认项目（v2）
    ├── v1-project-param.ts       # v1 路由的 ?project= 解析（400/404 语义）
    ├── v2-project-param.ts       # v2 路由的 [id] 解析（与 v1 同语义，防幽灵项目）
    └── utils.ts                  # cn() 工具
scripts/
├── run-with-log.mjs              # 跨平台「终端 + 日志文件」双写运行器（替代 Unix 的 tee）
├── copy-standalone.mjs           # 把 .next/static 与 public 拷进 standalone（替代 Unix 的 cp -r）
├── find-dead-code.mjs            # import 图可达性分析，列出不可达模块（死代码体检）
├── api-adversarial-test.sh       # v1 API 对抗测试（需 curl + jq + python3）
├── api-v2-smoke-test.sh          # v2 API 冒烟 + 对抗测试（需 curl + jq + python3）
├── backup-data.sh                # 数据备份（仅需 bash + tar + coreutils）
├── restore-demo-state.py         # 从 data-backup-before-step3 恢复演示状态
├── setup-demo-html-project.py    # 生成 HTML 演示项目
├── setup-demo-mixed.sh           # 生成混合类型演示项目
├── test-shrink.sh                # 弹层开合零位移验证（桩化 innerWidth）
├── repro-concurrent.sh           # 并发一致性复现脚本
└── gen-test-videos.sh            # 用 ffmpeg 生成多规格测试视频（产物不入库）
standalone.html                   # 免部署单页精简版（零依赖，与主应用互不依赖）
data/                             # 运行时数据（gitignore，不入库）
├── projects/[id]/manifest.json   # 项目清单（schema v2：items + layout + slotCount + settings）
├── projects/[id]/files/          # 项目内容文件（uuid 命名；zip 包为 [uuid].html/ 目录）
├── manifest.v1.bak.json          # v1 清单迁移备份
└── uploads.v1.bak/               # v1 上传目录迁移备份（文件已搬入项目 files/）
```

## 4. 架构与数据流

### 4.1 存储结构（schema v2，含 v1 自动迁移）

`data/projects/[id]/manifest.json` 是索引源（v1 的 `data/manifest.json` 在首次访问时自动迁移为默认项目并备份，一次性、幂等）：

```json
{
  "id": "default",
  "name": "默认项目",
  "status": "active",
  "items": [
    { "id": "uuid", "kind": "video", "title": "示例视频 1", "order": 0, "aspectRatio": null,
      "file": { "filename": "uuid.mp4", "originalName": "demo-01.mp4", "size": 104767, "mimeType": "video/mp4" } }
  ],
  "layout": { "rows": 2, "cols": 3 },
  "slotCount": 6,
  "settings": { "aspectRatio": "original", "showTitles": true, "showInfo": true, "loop": false, "muted": true, "playbackRate": 1 }
}
```

- `items[].id`：全生命周期稳定锚点；`order` 决定矩阵位置，**恒为 0..n-1 紧凑无空洞**（任何增删后服务端重排）
- `items[].kind`：`video | html`（MVP）；html 另有 `status` 加载状态字段；image/svg 等第二阶段预留
- `slotCount`：可见窗格数（v1 count 的沿用，1–12）；`layout` 可为显式行列或 `"auto"`（近方形）
- v1 兼容：`/api/videos*` 仍以 slot 位置语义工作（slot i ↔ order i），由 `video-store.ts` 门面适配；Step 5 起 slot 视图携带扩展字段 `kind`（'video' | 'html'）与 `html`（HTML 条目的文件元数据）；Step 6 起清单携带 `layoutMode`（'auto' | 'manual'）；Step 7 起 slot 携带单卡比例覆盖 `aspectRatio`、清单携带 `settings`（播放与展示设置），旧客户端可安全忽略
- 旧清单/旧文件迁移后改名为 `manifest.v1.bak.json` / `uploads.v1.bak/`，确认无误后可删除

### 4.2 并发与一致性（重要不变量）

1. **原子写**：清单写盘一律先写临时文件再 `rename`，杜绝半截 JSON（`project-store.ts: writeProject`）
2. **进程内互斥锁（按项目维度）**：所有「读清单 → 改 → 写回」的临界区必须包在 `withProjectLock(projectId, fn)` 里（每项目一条 Promise 队列串行化），否则并发上传会互相覆盖（lost update）。v1 的 `withManifestLock()` 即默认项目锁。**新增改清单的 API 时必须同样包锁**。锁队列挂在 `globalThis` 上：Next dev 下模块会被重复求值（HMR、按路由独立打包），模块级 Map 会随实例重建而丢失、导致并发请求各自持锁
3. **上传严格校验**：v1 `slot` 参数必须是匹配 `/^\d{1,2}$/` 的字符串后才转数字（防 `Number(null) === 0` 静默落位 0）；v1/v2 上传 kind 均由服务端按 MIME + 扩展名双判（视频或单文件 HTML，HTML 限 ≤10MB）
4. **删条目必须删文件（集中式清理）**：v1 门面的 `writeManifest` 在写盘前对比新旧条目的文件引用差集，统一删除被移除/被替换的文件（含 v1 视图 `video=null` 看不见的 HTML 文件）；v2 删除条目先写清单再删文件。即使文件删除失败也不产生死链
5. **HTML / SVG 安全响应头**：`/api/files/[name]` 与 `/api/bundles/[name]/[...path]` 对 `.html` **和 `.svg`** 一律强制 `CSP: sandbox allow-scripts` + `nosniff` + `no-store` + `Content-Disposition: inline; filename="sandbox.*"`，绝不可去掉（蓝图 §11）；前端 iframe 同样仅给 `allow-scripts`（绝不 `allow-same-origin`）。
   - `.svg` 必须与 `.html` 同级对待：SVG 可内嵌 `<script>`，作为顶层文档直接打开会在**本站源**下执行脚本。早期只有 `files` 路由做了防护、`bundles` 路由漏了，等于给 zip 包留了一条绕过沙箱的存储型 XSS 通道。
6. **迁移不可被绕过**：所有数据读取路径（`readProject('default')`）会先跑一次幂等迁移。
   `readProject` 在清单缺失时会返回一份"空白默认项目"，任何 v2 写路径（PATCH settings/layout 等）都会把它落盘，从而提前占用迁移的幂等判据，让 v1 老数据**永远迁不进来**。把迁移挂在读取入口，任何调用路径都无法绕过。
7. **项目必须真实存在**：所有 v2 路由先用 `resolveProjectId(id)` 解析 —— 格式非法 400、默认项目走幂等迁移、其余不存在一律 **404**。绝不允许因为 `readProject` 的兜底默认值而凭空造出项目目录（幽灵项目会污染项目列表并占磁盘）。
8. **`slotCount ≥ items.length` 且 `items.length ≤ SLOT_MAX`**：v1 视图按 `slotCount` 输出槽位，一旦窗格数小于条目数，尾部条目在 v1 视图里不可见，就会被 v1 写路径当成"已删除内容"连文件一起清理掉。v2 上传会把 `slotCount` 抬到条目数，`readProject` 也会在读取时修正历史数据。
9. **v1 写路径默认不删"看不见的"条目**：`writeManifest(manifest, projectId, { allowTruncate })`。只有"缩减窗格数"与"清空全部"这两个语义明确的写路径才传 `allowTruncate: true`；其余路径保留视图寻址范围外的条目，而不是静默删除用户文件。
10. **清单先落盘、文件后删除**：所有写路径统一这个顺序。先删文件再写清单，一旦写清单失败就会留下引用已删文件的死链卡片。
11. **zip 必须流式解压**：见 4.5。
12. **JSON 响应显式声明 charset**：`Content-Type: application/json; charset=utf-8`，避免客户端按本地编码猜测导致中文乱码。

### 4.3 播放与同步

- 卡片使用 `object-contain`，任何分辨率的视频都**完整显示不裁切**
- 「同时播放」流程：全部暂停并 `currentTime = 0` → 80ms 后统一 `play()`，实现近似同步起播
- 默认**静音**（`defaultSettings()`：`muted=true`、`loop=false`），以符合浏览器自动播放策略；`loop`/`muted` 直接写 DOM 属性（React 对这两个属性更新不可靠），设置值持久化到服务端 `Project.settings`
- **纯 HTML 项目没有播放语义**：当前项目只有 HTML 页面时，「同时播放 / 暂停」按钮整组隐藏，主动作变为「刷新全部」（重载全部 iframe 回到初始状态），「显示」菜单中循环/静音/速度三项禁用并附提示（2026-08-29 用户确认「没有播放按钮这一说」；D11 顶栏随内容自动适配）
- **顶栏固定两行恒定高度**：第一行品牌/项目切换/使用须知/主题，第二行功能按钮（不换行，窄屏横向滑动）；行高不随项目内容与按钮显隐变化，切换项目时主体内容零位移（D11 震动根治）
- **弹层零位移**：Radix modal 弹层默认会给 body 注入「滚动条宽度」的右边距补偿，与常驻滚动条策略叠加导致每次弹层开/关页面被压窄 15~17px；已按选择器优先级归零该补偿，下拉/对话框开合时页面宽度恒定（D12，无头环境是 overlay 滚动条无法自然复现，验证脚本 scripts/test-shrink.sh 桩化 innerWidth 模拟经典滚动条）

### 4.4 交互防抖动设计

- `html { overflow-y: scroll; scrollbar-gutter: stable }`：滚动条槽位常驻，切换数量导致页面高度跨过视口时视口宽度不变，导航栏零抖动
- 导航栏动态文字（「已放置 x/x」「行×列」）用 `tabular-nums` + `min-w-[Nch]` 定宽，数字位数变化不挤动相邻按钮
- **项目切换零跳动**：切换项目不再替换为骨架屏（骨架与真实卡片高度差导致两跳），改为保留旧内容进入 `switching` 过渡态（主区渐隐至 45% + 禁交互），新数据一次性替换后渐显；本地响应快时窗口极短无感，慢网络下平滑过渡

### 4.5 上传与 zip 解包（安全边界）

- **kind 双判**：服务端按 MIME + 扩展名双重判定，两者不一致时以"能明确识别的那个"为准并拒绝可疑组合
- **原文件名只入 JSON 不入磁盘**：落盘文件名恒为 `uuid + 扩展名`；`originalName` 经 `sanitizeOriginalName` 去掉路径分隔符与控制字符后才存清单
- **zip 流式解压 + 三层限额**（`project-store.ts: saveBundle`）：
  1. `onfile` 阶段用中央目录声明的 `originalSize` 预检总量与条目数 —— 典型 zip 炸弹在**没有付出任何解压成本**时就被拒绝；
  2. `ondata` 阶段累计**实际**解压字节数，声明值被伪造也能在越限瞬间中止（内存上界 = 限额本身）；
  3. 路径逐段校验（`..`、绝对路径、盘符、空字节、Windows 保留设备名），扩展名走白名单。
  全部通过后才落盘，失败不留半包。
- **越限中止的实现细节**：在 `ondata` 回调里抛错会被 fflate 用空 chunk 再次回调、噪音异常盖掉真实原因，所以先记录 `aborted` 再抛，由 `push` 之后的统一出口上报。

## 5. 运行指南

### 5.1 环境要求

- Node.js ≥ 20.9（或 Bun ≥ 1.1）—— `dev`/`build`/`start` 三个脚本都通过 `node` 调用，Node 是硬要求
- 运行本身不需要其他依赖；以下是**可选**工具：
  - Docker（生产方式，见 5.4）；ffmpeg（仅生成测试视频用）
  - `curl` + `jq` + `python3`（跑 `scripts/api-*-test.sh` 对抗测试用；缺 `jq` 脚本会直接失败）
  - bash + tar + coreutils（跑 `scripts/backup-data.sh` 用，**刻意不依赖 ripgrep**）

### 5.2 安装与开发模式

```bash
bun install          # 或 npm install
bun run dev          # 或 npm run dev，监听 http://localhost:3000
```

开发模式会同时把日志写到终端与 `dev.log`，由 `scripts/run-with-log.mjs` 实现（该文件已 gitignore）。
该脚本还会**预检端口**并给出可执行的处置建议，见 5.6。

> 历史坑：这三个脚本原先写作 `next dev -p 3000 2>&1 | tee dev.log` / `cp -r ...` / `NODE_ENV=production bun ...`，
> 全是 Unix 专有写法 —— Windows 上服务能起来但 `dev.log` 恒为 0 字节，`build` 会在 `next build` 成功之后
> 因 `cp -r` 失败而**静默产出不完整的 standalone 产物**（首页 200、静态资源全部 404，浏览器一片空白）。
> 现已全部换成 `node scripts/*.mjs`，Windows / macOS / Linux 行为一致。
>
> 另一个坑：Windows 下 `next` 是 `node_modules/.bin/next.cmd` 包装，spawn 必须经 shell，而
> `shell: true` 会触发 `DEP0190`（子进程参数只拼接、不转义）。现在改为用 `node` 直接执行
> `node_modules/next/dist/bin/next`，既避开 shell 也不丢参数 —— **不要再改回 shell: true**。

### 5.3 生产构建与启动

```bash
bun run build        # next build + 把 .next/static 与 public 拷进 standalone（含拷贝自检）
bun run start        # NODE_ENV=production PORT=3000 node .next/standalone/server.js
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
```

构建产物已通过完整验证：**18 个路由**正确生成、standalone 启动后首页/清单 API 与静态资源均正常、`tsc --noEmit` 与 eslint 零错误（CI 中每次提交都会复验，见 `.github/workflows/ci.yml`）。

### 5.4 Docker 部署（推荐生产方式）

项目含服务端文件存储（`data/`），适合带持久卷的单机部署（VPS / 家用服务器），Docker 三件套已随仓库提供：

```bash
docker compose up -d --build     # 构建镜像并启动，监听 3000 端口
docker compose logs -f           # 查看日志
```

- **多阶段构建**（`Dockerfile`）：bun 安装依赖 → bun 构建 → node:24-slim 运行 standalone 产物，镜像内不含源码与依赖
- **数据持久化**（`docker-compose.yml`）：宿主机 `./data` 挂载到容器 `/app/data`，上传的视频/HTML 与清单全部落在这里——**升级镜像不丢数据，删除容器不丢数据**
- 健康检查：容器内每 30s 探测 `/api/videos`，异常自动重启
- 反向代理建议：生产环境建议在前面加一层 Nginx/Caddy 做 HTTPS 与 gzip（上传大文件注意调大 `client_max_body_size`，本项目上限 200MB）

### 5.5 数据备份与恢复

```bash
bash scripts/backup-data.sh          # 打包 data/ 下的项目数据 → backups/，默认保留 14 份
KEEP=30 bash scripts/backup-data.sh  # 自定义保留份数
DEST=/var/backups bash scripts/backup-data.sh
```

- 备份为 tar.gz（含全部项目清单 + 文件），先写临时名再原子改名，不会产生半个包
- **同时覆盖尚未迁移的 v1 数据**：除 `projects/` 外，若存在 `data/manifest.json`、`data/uploads/`、
  `data/uploads.v1.bak/` 也会一并打包 —— "升级前先备份一次"恰恰是最需要它们的时刻
- 恢复：`tar -xzf <备份包> -C data/`（解出 `projects/` 等目录）后重启服务
- 建议用 crontab 每日定时备份：`0 3 * * * cd /path/to/omnicompare && KEEP=14 bash scripts/backup-data.sh`

### 5.6 修改端口

- 开发：`PORT=3001 bun run dev`（Windows 用 `set PORT=3001 && bun run dev`）
- 生产：`PORT=8080 bun run start`（standalone 读 `PORT` 环境变量）
- 两个脚本都通过 `--port <n>` 声明默认端口（3000），并**在启动前预检**：被占用时直接
  打印占用进程 PID 与三种处置方式，而不是把 `EADDRINUSE` 堆栈丢给用户
- 端口取值优先级：环境变量 `PORT` > 脚本默认值。**环境变量生效时脚本会明确提示**——
  本机 shell 里可能存在别的工具设的 `PORT`，静默沿用会造成"文档写 3000、实际起在别处"
  的端口漂移，比直接报错难查得多
- 注意 Next 的语义差异：用 `-p` 显式指定端口时不会自动换端口，用 `PORT` 环境变量同样
  绑定该端口不重试；只有**两者都不给**时才允许自动换端口。本项目刻意选择"确定即确定"，
  避免服务悄悄跑在别的端口上

### 5.7 如何关闭

| 场景 | 关闭方式 |
|---|---|
| 前台 dev / start | 终端里 `Ctrl + C` |
| 后台进程 | `kill <PID>`；或 `lsof -ti:3000 | xargs kill`（释放 3000 端口） |
| dev.log 持续增长 | 直接删除，不影响运行 |

## 6. 使用指南（用户视角）

1. **多项目管理**：顶栏项目切换器可新建/切换项目（按进行中/草稿/归档分组，条目右侧角标标明内容构成：视频数 / 网页数）；侧栏项目卡「管理」支持改名、切换状态、删除项目（默认项目不可删），卡片内显示「x 视频 · y 网页」构成；当前项目记住在本地，刷新后保持
2. **选数量与矩阵**：点「布局」→ 上半区选内容位个数（1–12），下半区选几行几列；标注「补」的矩阵不整除，末尾会留空格子。单内容（1 个）自动满幅
3. **上传**：点任意空位选文件；或把文件直接拖进页面；或点「一键导入」多选文件。文件多于空位时自动扩位
4. **写标题**：每个内容下方的标题框，点击输入，失焦后自动收折，600ms 防抖保存，最多 100 字
5. **播放与显示（顶栏随内容自动适配）**：含视频的项目显示「同时播放 / 暂停」；纯 HTML 项目没有播放概念，主动作自动变为「刷新全部」（重载全部页面回到初始状态）；混合项目两者并存（播放仅对视频生效）。循环/静音/播放速度/标题显隐/属性显隐统一收在顶栏「显示」菜单，状态保存在服务端随项目记住。无需手动选模式——导入什么内容，顶栏就长出什么控件
6. **使用须知**：顶栏项目切换器右侧的书本按钮可随时查看完整使用说明（弹窗形式，点空白处 / Esc / 关闭按钮均可关）
7. **删除**：卡片右下角垃圾桶删除单个；导航栏垃圾桶清空全部（需确认，不可恢复）
8. **缩减位数**：若被移除区间里有内容，会弹确认框告知删除数量，确认后文件同步删除

## 7. API 参考

所有接口返回 JSON；错误统一 `{ "error": string }` + 4xx。响应均带 `Cache-Control: no-store` 与
`Content-Type: application/json; charset=utf-8`（显式声明编码，避免客户端按本地编码猜测）。

**多项目（Step 8）**：以下 v1 端点均支持可选查询参数 `?project=<项目id>`（缺省 = 默认项目，旧客户端零改动兼容）；指定不存在的项目返回 404，非法 id 返回 400。

| 方法与路径 | 参数 | 成功返回 | 失败 |
|---|---|---|---|
| `GET /api/videos` | — | 完整 Manifest | — |
| `POST /api/videos/upload` | FormData：`file`（视频 ≤200MB / 单文件 HTML ≤10MB / 图片 ≤20MB（PNG/JPG/GIF/WebP/SVG/BMP/AVIF）/ zip 包 ≤50MB，kind 服务端双判；zip 解压为 bundle 型 HTML 条目）、`slot`（0-based 数字字符串） | 更新后的 Manifest（slots 带扩展字段 kind/html/image/bundle）；被替换条目的旧文件/旧包目录同步删除 | 400 缺参/类型/大小/位置非法/包校验失败 |
| `PATCH /api/videos` | JSON：`{ slot, title?, aspectRatio? }`（至少一项），标题 trim 后截断到 100 字；aspectRatio 为单卡比例覆盖（'16:9'/'9:16'/'1:1'/'original'/'custom' 或 null=恢复跟随全局，蓝图 §13） | 更新后的 Manifest | 400 |
| `DELETE /api/videos?slot=i` | 删除位置 i 的视频 | 更新后的 Manifest | 400/404 |
| `DELETE /api/videos?all=1` | 清空全部视频与标题，**保留**当前数量与矩阵 | 更新后的 Manifest | 400 |
| `PATCH /api/videos/layout` | JSON：`{ count(1-12), rows, cols }`，须满足 `rows*cols >= count`；缩减时删除被移除区间的文件 | 更新后的 Manifest | 400 非法参数/矩阵放不下 |
| `PATCH /api/videos/settings` | JSON：`{ aspectRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate?(0.5/1/1.25/1.5/2), letterboxFill?(base/blur) }` 全部可选，仅更新提供的字段（Step 7，全局比例/标题与属性显隐/播放设置；Step C 留白填充） | 更新后的 Manifest（含 settings） | 400 |
| `GET /api/files/[name]` | `name` 为 uuid 文件名（跨项目解析）；支持 `Range` 请求头；`.html`/`.svg` 强制沙箱安全响应头且禁缓存 | 200 全量 / 206 分片流 | 404（含路径穿越 `..%2F`）；非法 Range 416 |
| `GET /api/bundles/[name]/[...path]` | zip 包内静态资产：`name` = 包目录名（[uuid].html），`path` = 包内相对路径，缺省 = `index.html`；包内 `.html`/`.htm`/**`.svg`** 同样强制 CSP 沙箱 | 200 资产流 | 400/404（含穿越） |

**schema v2 接口（新 UI 与二次开发使用）：**

> 所有 v2 路由共用同一套 id 解析（`src/lib/v2-project-param.ts`）：**格式非法 → 400；默认项目 → 先跑幂等迁移；其余项目不存在 → 404**。
> 不存在的项目绝不会被"顺手创建"。

| 方法与路径 | 参数 | 成功返回 | 失败 |
|---|---|---|---|
| `GET /api/projects` | — | 项目数组 | — |
| `POST /api/projects` | JSON：`{ name? }` | 201 + 新项目（uuid id） | 400 |
| `GET /api/projects/[id]` | — | 项目全量（含 items） | 400 非法 id / 404 不存在 |
| `PATCH /api/projects/[id]` | JSON：`{ name?, status? }`，status ∈ active/draft/archived | 更新后的项目 | 400 / 404 |
| `DELETE /api/projects/[id]` | — | `{ ok: true }`；默认项目受保护 | 403 删默认项目 / 404 不存在 |
| `GET /api/projects/[id]/items` | — | 条目数组（order 紧凑） | 400 / 404 |
| `POST /api/projects/[id]/items/upload` | FormData：`file`（视频 ≤200MB / HTML ≤10MB / 图片 ≤20MB / zip ≤50MB，kind 服务端判定）、`order?`（插入位置，缺省追加）、`title?` | 201 + `{ item, items }`；`slotCount` 随条目数上调 | 400 类型/大小/缺参/包校验失败/**条目数已达 SLOT_MAX** / 404 |
| `PATCH /api/projects/[id]/items/[itemId]` | JSON：`{ title?, aspectRatio?(枚举或 null), order? }` | `{ item, items }` | 400/404 |
| `DELETE /api/projects/[id]/items/[itemId]` | — | `{ items }`（其余条目紧凑重排，文件同步删除） | 404 |
| `PATCH /api/projects/[id]/layout` | JSON：`{ mode: 'auto' }` 或 `{ rows, cols }`（容量 ≥ max(slotCount, 条目数)） | 更新后的项目 | 400 / 404 |
| `PATCH /api/projects/[id]/settings` | JSON：`{ aspectRatio?, customRatio?(null 清除，宽高需为 0-10000 的有限正数), showTitles?, showInfo?, loop?, muted?, playbackRate?(0.5/1/1.25/1.5/2), letterboxFill?(base/blur) }` | 更新后的项目 | 400 / 404 |

## 8. 数据持久化与备份

- 全部状态就在 `data/` 一个目录里：**备份 = 复制 `data/`**；迁移 = 复制后重启
- `data/` 已在 `.gitignore` 中，**永远不要提交用户视频到 git**
- 重置演示数据：`DELETE /api/videos?all=1` 后重新上传即可（数量与矩阵会保留）

## 9. 测试

```bash
# 1) 生成测试视频（需 ffmpeg，任意几个几秒的小视频即可）
mkdir -p scripts/test-videos
ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=24:duration=3 -pix_fmt yuv420p scripts/test-videos/v01.mp4
# …按需生成更多不同分辨率/时长的视频（v01~v12，可用 scripts/gen-test-videos.sh）

# 2) 启动开发服务器后运行对抗测试（需 curl + jq + python3；缺 jq 会直接失败）
bash scripts/api-adversarial-test.sh   # v1 兼容层 160 项（含 §20 图片/§21 zip 包专项）
bash scripts/api-v2-smoke-test.sh      # v2 API 38 项（会在 default 外新建临时项目并自动清理）

# 3) 静态体检（任一失败即需修复）
bun run typecheck                      # tsc --noEmit
bun run lint                           # eslint .
bun run scripts/find-dead-code.mjs     # import 图可达性，列出死代码
```

测试覆盖：v1 清单结构、布局非法参数 9 组、标题非法 7 组 + 截断、上传对抗 6 组、替换删旧文件、3 路并发一致性、缩减删文件、Range 206/416、路径穿越防护、清空无残留、排序专项（§19）；图片专项（§20）：kind 判别/SVG MIME/超大与非法类型拒收/服务响应头（immutable 与 CSP 沙箱）/替换清理；zip 包专项（§21）：bundle 标志/缺入口/zip-slip/白名单外扩展拒收/入口与深层资产服务/包内穿越 404/标志往返/包目录清理；v2 项目 CRUD、多类型上传与 kind 判别、HTML 安全响应头（CSP sandbox/nosniff/no-store）、条目排序/删除紧凑重排、布局 auto/显式、设置逐字段校验（含 letterboxFill）、默认项目删除保护。每项二元判定（通过/失败），末尾汇总。

> 注意：这两个脚本是**二元判定**，不覆盖下面这些 2026-09 修复项的行为，改动相关代码时需要手工回归
> （或用本仓库同款手法写 PowerShell/Node 版断言）：
> 包内 `.svg` 沙箱头、迁移不被 v2 写路径绕过、不存在的项目返回 404、zip 越限时的内存上界、
> v2 条目数上限与 `slotCount` 联动、v1 写路径保留视图外条目。

## 10. 注意事项与已知限制

1. **无鉴权，勿裸奔公网**：所有 API 没有任何认证，任何人可上传/删除。公网部署请务必在反向代理层加 Basic Auth、IP 白名单或改造成登录制。`public/robots.txt` 因此默认 `Disallow: /`（无鉴权站点不应被搜索引擎收录）
2. **互斥锁仅单进程有效**：`withProjectLock` 是进程内 Promise 队列。多实例/多机部署会破坏一致性，需改为文件锁、Redis 锁或数据库
3. **浏览器自动播放策略**：非静音的自动播放会被拦截，因此默认静音；起播动作都在用户点击之后发生
4. **上限一览**：`MAX_FILE_SIZE`(视频 200MB)、`MAX_IMAGE_SIZE`(20MB)、`MAX_BUNDLE_SIZE`(zip 50MB)、`MAX_BUNDLE_UNCOMPRESSED`(解压后 120MB)、`MAX_BUNDLE_FILES`(300)、`SLOT_MAX`(12) 均定义在 `src/lib/types.ts`，调整后前后端自动生效；更多位数在大屏下才有意义，移动端建议 ≤ 8。
   `SLOT_MAX` 同时是**条目数上限**：v1 的"内容位"与 v2 的"条目"是同一个 12 的约束，两端点行为必须一致
5. **上传未做秒传/断点续传**：FormData 整包上传，超大视频受服务器 body 限制约束（Next 默认无限制，反代可能有限制，如 nginx `client_max_body_size`）
6. **标题 100 字**：前后端双重限制，超出截断
7. **zip 包约束**：须含根级 `index.html`；资产扩展名白名单（web 常用格式，见 `BUNDLE_ASSET_EXTS`）；解压后总量 ≤120MB、文件数 ≤300；路径段不得为 `..`、绝对路径、盘符或 Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）；页面内引用请用相对路径（绝对路径 `/x` 会落到主站而非包内）
8. **zip 采用流式解压**：边解压边累计，越限立即中止，内存占用上界就是 120MB 限额本身。**不要改回 `unzipSync` 一次性解压再校验** —— 那样 300KB 的 zip 炸弹就能让进程 RSS 暴涨数百 MB，而上限允许的 50MB 包理论上可申请数十 GB
9. **`components/ui/` 只保留实际用到的组件**：其余 43 个 shadcn 组件已作为死代码删除（约 4.9k 行）。需要新的直接 `npx shadcn@latest add <组件名>`（`components.json` 已配好；其 `tailwind.config` 为空是 Tailwind v4 的正常形态）。用 `bun run scripts/find-dead-code.mjs` 可随时复检可达性
10. **测试资产不入库**：`scripts/test-videos/`、`scripts/shots/` 已 gitignore，需要时按第 9 节自行生成

## 11. 给 AI 编码助手的快速上下文

改代码前请遵守以下不变量，违反任何一条都会引入真实 bug（均为历史教训）：

- 改清单的 API 临界区**必须**包 `withManifestLock` / `withProjectLock`（见 4.2）
- 上传的 `slot` 校验保持严格字符串正则，勿用裸 `Number()`
- 删除/替换/缩减时**必须**同步删磁盘文件，且顺序恒为**先写清单、后删文件**
- 新增 v2 路由**必须**先过 `resolveProjectId(id)`，不要直接 `readProject(id)` —— 后者在清单缺失时会返回"空白默认项目"，写下去就是凭空造项目 + 迁移判据被占
- 新增"减少内容"语义的 v1 写路径时，显式传 `{ allowTruncate: true }`；默认行为是**保留**视图外的条目
- `slots.length === count`、`rows*cols >= count`、`slotCount >= items.length` 由服务端维护，前端不要自行裁剪数组
- `layout`/`video` 的服务端校验逻辑在 `video-store.ts: isValidLayout / validateUploadFile`，客户端镜像逻辑在 `types.ts: isVideoFile`
- 比例取值只用 `types.ts` 的 `ASPECT_RATIOS` / `PLAYBACK_RATES` / `parseCustomRatio`，不要在路由里各写一份
- `.html` 与 `.svg` 的沙箱响应头**两条路由都要**（`files` 与 `bundles`），漏一条就是存储型 XSS
- zip 解包保持流式 + 双重限额（声明值预检 + 实际累计），勿改回 `unzipSync`
- toast 一律按通道带固定 `id`（layout/import/slot/clear/play），防止快速操作时叠加
- 视频元素永远 `object-contain`，不要改成 cover（会裁切，违背项目初衷）
- 样式：不要移除 `globals.css` 里 `html` 的滚动条常驻规则和导航栏定宽规则（防抖动）
- 改完跑四件套：`bun run typecheck` + `bun run lint` + `bun run build` + `bash scripts/api-v2-smoke-test.sh`

## 12. 许可证

本项目以 [MIT License](./LICENSE) 开源发布。在不违反许可条款的前提下，任何人可自由使用、修改与分发本项目的代码；项目本身不提供任何担保，部署后的内容管理与访问控制由使用者自行承担。第三方依赖（Next.js、React、Tailwind CSS 等）各自遵循其原始许可证，本项目的 MIT 许可证不改变它们的授权条款。

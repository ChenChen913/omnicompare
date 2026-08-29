# 视频墙（Video Wall）项目详解

> 本文档面向**后续接手开发的工程师与 AI 编码助手**，目标是让任何人和任何 AI 在 10 分钟内完整理解本项目的结构、运行方式与全部约束。快速上手请看 [README.md](./README.md)。

---

## 1. 项目简介

「视频墙」是一个**多视频矩阵展示 H5 页面**：用户先决定要放几个视频（1–12 个）和几行几列的排列矩阵，然后通过点击或拖拽批量上传视频、为每个视频写标题介绍，最后一键「同时播放」让所有视频同步起播。适合多机位对比、多素材预览、监控墙式的展示场景。

核心能力一览：

- **动态数量**：视频位数量 1–12 任意切换，单视频时自动满幅展示
- **矩阵布局**：任意「行 × 列」组合（整除矩阵按近方形排序；质数数量自动提供「补空位」矩阵选项）
- **批量上传**：点击空位上传、整页拖拽导入、一键多选导入；文件数超过当前位数时自动扩位并匹配矩阵
- **标题介绍**：每个视频下方有标题框，自动增高、防抖保存（600ms），刷新不丢
- **同时播放**：所有视频统一回到开头后同步起播；支持批量静音/取消静音、循环开关
- **服务端持久化**：视频文件与清单全部存服务器，刷新页面、换设备打开均不丢失
- **缩减保护**：减少视频位数时，若会移除已有视频，弹出确认框明确告知将删除的数量

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 16（App Router）+ React 19 | 前端页面与 API Routes 同仓同进程 |
| 语言 | TypeScript 5（strict） | 全量类型覆盖 |
| 样式 | Tailwind CSS v4 + shadcn/ui（Radix 封装） | 暗色主题；组件在 `src/components/ui/` |
| 提示 | sonner（toast）+ 自定义 AlertDialog | toast 按通道固定 id 去重，位置 bottom-center |
| 图标 | lucide-react | |
| 存储 | **文件系统 + JSON 清单**（无数据库） | `data/uploads/` 存视频，`data/manifest.json` 存索引 |
| 包管理 | Bun（含 `bun.lock`） | npm/pnpm 亦可，但没有 lock 文件 |
| 流媒体 | 原生 `<video>` + 自实现 HTTP Range 206 | 见 `src/app/api/files/[name]/route.ts` |

> 注意：`prisma/schema.prisma`、`.env` 中的 `DATABASE_URL` 是脚手架残留，**本项目不使用数据库**，可忽略。

## 3. 目录结构（关键文件地图）

```
src/
├── app/
│   ├── layout.tsx                # 根布局：字体、全局 Toaster（bottom-center）
│   ├── globals.css               # 主题变量、no-scrollbar、滚动条槽位常驻（防抖动）
│   ├── page.tsx                  # 首页，仅渲染 <VideoWall />
│   └── api/
│       ├── videos/route.ts       # GET 清单 / PATCH 标题 / DELETE 单个或全部
│       ├── videos/upload/route.ts# POST 上传（FormData: file + slot）
│       ├── videos/layout/route.ts# PATCH 调整数量与矩阵
│       └── files/[name]/route.ts # GET 视频文件流（支持 Range 206）
├── components/video/
│   ├── video-wall.tsx            # 主组件：头部控制栏、网格、批量逻辑、全部 toast
│   └── video-card.tsx            # 单格卡片：object-contain 不裁切、拖拽上传、标题自动增高
├── components/ui/                # shadcn/ui 基础组件（button/dialog/popover/sonner 等）
├── lib/
│   ├── types.ts                  # 前后端共享常量与类型（SLOT_MAX、MAX_FILE_SIZE、Layout…）
│   ├── video-store.ts            # 服务端存储层：清单读写、原子写、withManifestLock 互斥锁
│   └── utils.ts                  # cn() 工具
scripts/
├── api-adversarial-test.sh       # API 对抗测试（47 项二元断言，依赖 curl + jq）
└── gen-test-videos.sh            # 用 ffmpeg 生成多规格测试视频（本机未入库，可自行重建）
data/                             # 运行时数据（gitignore，不入库）
├── manifest.json                 # 清单：数量、矩阵、各位置标题与视频元数据
└── uploads/                      # 上传的视频文件（uuid 命名）
```

## 4. 架构与数据流

### 4.1 清单（Manifest）结构

`data/manifest.json` 是唯一的索引源：

```json
{
  "count": 6,
  "layout": { "rows": 2, "cols": 3 },
  "slots": [
    { "index": 0, "title": "示例视频 1",
      "video": { "filename": "uuid.mp4", "originalName": "demo-01.mp4", "size": 104767, "mimeType": "video/mp4" } },
    { "index": 1, "title": "", "video": null }
  ]
}
```

- `count`：当前视频位数量（1–12）；`layout.rows * layout.cols >= count`，多出的格子为留空占位
- `slots.length === count` 恒成立；调整数量/矩阵由服务端保证裁剪与补齐

### 4.2 并发与一致性（重要不变量）

1. **原子写**：清单写盘一律先写临时文件再 `rename`，杜绝半截 JSON（`video-store.ts: writeManifest`）
2. **进程内互斥锁**：所有「读清单 → 改 → 写回」的临界区必须包在 `withManifestLock()` 里（Promise 队列串行化），否则并发上传会互相覆盖（lost update）。现有 4 个 API 的临界区均已包锁——**新增改清单的 API 时必须同样包锁**
3. **上传严格校验**：`slot` 参数必须是匹配 `/^\d{1,2}$/` 的字符串后才转数字（防 `Number(null) === 0` 静默落位 0）
4. **删视频必须删文件**：替换上传、缩减布局、清空时，服务端同步删除被移除的磁盘文件，防止孤儿文件

### 4.3 播放与同步

- 卡片使用 `object-contain`，任何分辨率的视频都**完整显示不裁切**
- 「同时播放」流程：全部暂停并 `currentTime = 0` → 80ms 后统一 `play()`，实现近似同步起播
- 默认**静音**，以符合浏览器自动播放策略；`loop`/`muted` 直接写 DOM 属性（React 对这两个属性更新不可靠），并持久化到 localStorage

### 4.4 交互防抖动设计

- `html { overflow-y: scroll; scrollbar-gutter: stable }`：滚动条槽位常驻，切换数量导致页面高度跨过视口时视口宽度不变，导航栏零抖动
- 导航栏动态文字（「已放置 x/x」「行×列」）用 `tabular-nums` + `min-w-[Nch]` 定宽，数字位数变化不挤动相邻按钮

## 5. 运行指南

### 5.1 环境要求

- Node.js ≥ 20.9（或 Bun ≥ 1.1）
- ffmpeg（仅测试时生成视频用，运行本身不需要）

### 5.2 安装与开发模式

```bash
bun install          # 或 npm install
bun run dev          # 或 npm run dev，监听 http://localhost:3000
```

开发模式会同时把日志写入 `dev.log`（`tee dev.log`），该文件已 gitignore。

### 5.3 生产构建与启动

```bash
bun run build        # next build，产物为 standalone 模式
bun run start        # NODE_ENV=production bun .next/standalone/server.js
```

### 5.4 修改端口

- 开发：`next dev -p 3000`（改 `package.json` 的 dev 脚本）
- 生产：standalone 模式读 `PORT` 环境变量，`PORT=8080 bun .next/standalone/server.js`

### 5.5 如何关闭

| 场景 | 关闭方式 |
|---|---|
| 前台 dev / start | 终端里 `Ctrl + C` |
| 后台进程 | `kill <PID>`；或 `lsof -ti:3000 | xargs kill`（释放 3000 端口） |
| dev.log 持续增长 | 直接删除，不影响运行 |

## 6. 使用指南（用户视角）

1. **选数量与矩阵**：点右上「布局」→ 上半区选视频个数（1–12），下半区选几行几列；标注「补」的矩阵不整除，末尾会留空格子。单视频（1 个）自动满幅
2. **上传**：点任意空位选文件；或把文件直接拖进页面；或点「一键导入」多选文件。文件多于空位时自动扩位
3. **写标题**：每个视频下方的标题框，点击输入，失焦后自动收折，600ms 防抖保存，最多 100 字
4. **播放**：点「同时播放」一起看；「暂停」全停；「循环」「静音」是全局开关，状态会记住
5. **删除**：卡片右下角垃圾桶删除单个；导航栏垃圾桶清空全部（需确认，不可恢复）
6. **缩减位数**：若被移除区间里有视频，会弹确认框告知删除数量，确认后视频文件同步删除

## 7. API 参考

所有接口返回 JSON；错误统一 `{ "error": string }` + 4xx。响应均带 `Cache-Control: no-store`。

| 方法与路径 | 参数 | 成功返回 | 失败 |
|---|---|---|---|
| `GET /api/videos` | — | 完整 Manifest | — |
| `POST /api/videos/upload` | FormData：`file`（≤200MB 的视频）、`slot`（0-based 数字字符串） | 更新后的 Manifest；替换上传会删除旧文件 | 400 缺参/类型/大小/位置非法 |
| `PATCH /api/videos` | JSON：`{ slot, title }`，标题 trim 后截断到 100 字 | 更新后的 Manifest | 400 |
| `DELETE /api/videos?slot=i` | 删除位置 i 的视频 | 更新后的 Manifest | 400/404 |
| `DELETE /api/videos?all=1` | 清空全部视频与标题，**保留**当前数量与矩阵 | 更新后的 Manifest | 400 |
| `PATCH /api/videos/layout` | JSON：`{ count(1-12), rows, cols }`，须满足 `rows*cols >= count`；缩减时删除被移除区间的文件 | 更新后的 Manifest | 400 非法参数/矩阵放不下 |
| `GET /api/files/[name]` | `name` 为 uuid 文件名；支持 `Range` 请求头 | 200 全量 / 206 分片流 | 404（含路径穿越 `..%2F`）；非法 Range 416 |

## 8. 数据持久化与备份

- 全部状态就在 `data/` 一个目录里：**备份 = 复制 `data/`**；迁移 = 复制后重启
- `data/` 已在 `.gitignore` 中，**永远不要提交用户视频到 git**
- 重置演示数据：`DELETE /api/videos?all=1` 后重新上传即可（数量与矩阵会保留）

## 9. 测试

```bash
# 1) 生成测试视频（需 ffmpeg，任意几个几秒的小视频即可）
mkdir -p scripts/test-videos
ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=24:duration=3 -pix_fmt yuv420p scripts/test-videos/v01.mp4
# …按需生成更多不同分辨率/时长的视频

# 2) 启动开发服务器后运行对抗测试（需 curl + jq）
bash scripts/api-adversarial-test.sh
```

测试覆盖：清单结构、布局非法参数 9 组、标题非法 7 组 + 截断、上传对抗 6 组、替换删旧文件、3 路并发一致性、缩减删文件、Range 206/416、路径穿越防护、清空无残留。每项二元判定（通过/失败），末尾汇总。

## 10. 注意事项与已知限制

1. **无鉴权，勿裸奔公网**：所有 API 没有任何认证，任何人可上传/删除。公网部署请务必在反向代理层加 Basic Auth、IP 白名单或改造成登录制
2. **互斥锁仅单进程有效**：`withManifestLock` 是进程内 Promise 队列。多实例/多机部署会破坏一致性，需改为文件锁、Redis 锁或数据库
3. **浏览器自动播放策略**：非静音的自动播放会被拦截，因此默认静音；起播动作都在用户点击之后发生
4. **200MB / 12 位上限**：`MAX_FILE_SIZE` 与 `SLOT_MAX` 定义在 `src/lib/types.ts`，调整后前后端自动生效；更多位数在大屏下才有意义，移动端建议 ≤ 8
5. **上传未做秒传/断点续传**：FormData 整包上传，超大视频受服务器 body 限制约束（Next 默认无限制，反代可能有限制，如 nginx `client_max_body_size`）
6. **标题 100 字**：前后端双重限制，超出截断
7. **prisma / .env 为脚手架残留**：可安全忽略或删除，不影响运行
8. **测试资产不入库**：`scripts/test-videos/`、`scripts/shots/` 已 gitignore，需要时按第 9 节自行生成

## 11. 给 AI 编码助手的快速上下文

改代码前请遵守以下不变量，违反任何一条都会引入真实 bug（均为历史教训）：

- 改清单的 API 临界区**必须**包 `withManifestLock`（见 4.2）
- 上传的 `slot` 校验保持严格字符串正则，勿用裸 `Number()`
- 删除/替换/缩减时**必须**同步删磁盘文件
- `slots.length === count`、`rows*cols >= count` 由服务端维护，前端不要自行裁剪数组
- `layout`/`video` 的服务端校验逻辑在 `video-store.ts: isValidLayout / validateVideoFile`，客户端镜像逻辑在 `types.ts: isVideoFile`
- toast 一律按通道带固定 `id`（layout/import/slot/clear/play），防止快速操作时叠加
- 视频元素永远 `object-contain`，不要改成 cover（会裁切，违背项目初衷）
- 样式：不要移除 `globals.css` 里 `html` 的滚动条常驻规则和导航栏定宽规则（防抖动）

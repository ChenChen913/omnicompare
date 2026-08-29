# OmniCompare（灵动对比）开发蓝图

> 本文档是产品演进的开发依据，源自用户提供的 4 张 UI 原型（`upload/prototypes/`，Stitch 导出）、设计规范（`DESIGN.md`）与《功能需求梳理》（AI Comparison Workspace）。文档回答需求梳理第十八节的 19 项输出要求，并记录已确认的产品决策。任何一轮开发开工前，先对照本文档；改完代码后，更新「实施路线」的完成状态。

---

## 1. 产品核心定位

**OmniCompare（灵动对比）** 是一个多内容并行对比工作台：把多个 AI 模型 / AI 工具对同一 Prompt 生成的结果（视频、HTML 网页，后续图片、SVG 等）放进同一个页面矩阵中并行展示，用于视觉对比与评估。它不是视频网站，不是文件管理器，定位是 **AI Benchmark / AI Output Comparison Tool**。

前代产品「视频墙 Video Wall」是本产品的视频子系统，其服务端持久化、矩阵布局、批量播放、上传链路全部继承。产品名由「视频墙」更名为「OmniCompare / 灵动对比」，因为展示对象不再限于视频。

## 2. 决策记录（用户已确认，勿反复）

| # | 决策项 | 结论 |
|---|---|---|
| D1 | 仓库策略 | 在现有仓库上演进（2026-08 更名为 omnicompare），不另起新仓库 |
| D2 | 存储 | 服务端多项目存储（`data/projects/[id]/`），不退回 localStorage；理由：换设备不丢是既有卖点，HTML 渲染也必须走服务端 URL |
| D3 | HTML 范围 | MVP 只收**单文件自包含 .html**（内联 CSS/JS）；zip 资源包第二阶段 |
| D4 | 图片类型 | 严格按需求梳理放第二阶段；MVP 数据模型预留 type 字段即可 |
| D5 | 界面风格 | 借鉴原型：Studio/Focus 双工作模式，各支持暗/亮主题，暗色默认 |
| D6 | 节奏 | 分期慢慢加功能，每期可独立交付 |
| D7 | 空状态风格 | 无视频/空位一律用简单文字提示（可附最小上传引导），禁止插画、花哨占位图；Step 8 空状态引导页同样遵守（2026-08-29 确认） |
| D8 | 轻量入口 | 免部署单页精简版 `standalone.html` 随仓库根目录分发（零依赖，video1~6.mp4 同目录即用）；与主应用互不依赖，仅作临时演示入口（2026-08-29 确认） |
| D9 | 信息显隐 | 标题与属性信息独立显隐：顶栏「标题」按钮只控制标题输入框，「属性」按钮只控制标题下方信息行（文件名/大小/比例/操作），便于按需组合观看/录屏；导航栏「已放置 x/x」计数徽标无用已移除（2026-08-29 用户反馈） |

## 3. 与现有项目的复用清单

直接复用（不改或小改）：

- 上传链路：FormData 上传、严格 slot 校验、`withManifestLock` 进程内互斥、原子写、删文件同步清理
- 视频流：`/api/files/[name]` HTTP Range 206、`object-contain` 不裁切、默认静音自动播放策略
- 交互细节：toast 通道固定 id 防叠加、`scrollbar-gutter: stable` 防抖动、导航栏定宽数字、缩减二次确认
- 依赖：`@dnd-kit/*`（拖拽排序）、`zustand`（全局状态）、`next-themes`（主题）已安装待启用

需要重构：清单 schema（video-only → ContentItem + Project 两层）、页面壳（单页 → Studio/Focus 双模式）、布局系统（新增 Auto Layout）。

全新开发：HTML 类型全链路（上传、sandbox 渲染、状态显示）、双主题落地、比例系统、标题显隐、播放速度、项目管理（草稿/归档）。

## 4. 用户核心使用流程

1. 进入工作台（Studio 模式，暗色）→ 空状态引导（对应原型 4：全页拖放 + 选择文件 + 格式提示）
2. 拖入/选择一批文件（视频与 HTML 混合）→ 系统按文件类型生成 Content Item，自动推荐矩阵（Auto Layout）填充网格
3. 为每个 Item 命名（通常填模型名，如 GPT / Claude / Gemini）→ 底部标题居中显示
4. 需要调整时：拖拽卡片排序、换矩阵、改全局比例；点击卡片进入「激活态」做单卡控制
5. 观看对比：顶栏全局控制（全部播放 / 暂停 / 重新开始 / 循环 / 声音 / 速度），只作用于视频
6. 演示/录屏时切换 Focus 模式（隐藏管理 UI），可随时切回 Studio，状态不丢
7. 项目可留在「草稿」，重要对比「归档」；换设备打开同一服务端数据不丢

## 5. 页面功能结构

```
┌─ 顶栏：品牌 · 项目页签（进行中/草稿/归档）· 全局控制条（播放/暂停/重开/循环/声音/速度/比例/矩阵/标题显隐/主题切换）
├─ Studio 模式
│   ├─ 左侧栏（可展开/收起）：项目信息 · 添加内容 · 视图切换（工作空间/库/布局/设置）· 当前活动窗格列表
│   └─ 主区：内容矩阵网格（卡片：缩略内容 + 状态点 + 类型图标 + 底部居中标题）+ 末尾虚线空位
└─ Focus 模式
    └─ 极简顶栏（品牌 + 模式徽标 + 退出/刷新/矩阵）+ 满幅内容网格，无侧栏无管理控件
```

- Studio 与 Focus 共享同一份内容与播放状态，切换仅改变壳层，不得导致内容丢失、排序改变、播放中断或布局异常
- 第一阶段「库 / 设置」两个侧栏入口仅为占位（禁用态），对应功能在后续阶段评估

## 6. Content Item 数据模型（schema v2 核心）

```ts
type ContentKind = 'video' | 'html';            // MVP；预留 'image' | 'svg' | 'markdown' | 'pdf'

interface BaseItem {
  id: string;            // uuid，全生命周期不变（替代 v1 以 slot index 定位的弱设计）
  kind: ContentKind;     // 类型判别字段，渲染层据此分发到对应 Panel
  title: string;         // ≤100 字，trim 后入库
  order: number;         // 排序位置（拖拽排序写此字段）
  aspectRatio: AspectOverride | null; // null = 跟随全局
  createdAt: string;
  updatedAt: string;
}

interface VideoAsset { kind: 'video'; file: FileMeta; }        // FileMeta = v1 的 filename/originalName/size/mimeType
interface HtmlAsset  { kind: 'html';  file: FileMeta; status: 'loading' | 'ready' | 'error'; }

type ContentItem = BaseItem & (VideoAsset | HtmlAsset);        // discriminated union
```

要点：

- 以 `id` 为稳定锚点，`order` 决定矩阵位置，拖拽排序只改 order，不重建对象
- `kind` 判别联合：后续新增类型 = 新增一个 Asset 分支 + 一个 Panel 组件，不动骨架
- HTML 的 `status` 是**加载状态**（iframe onload/onerror），不是时间轴同步，原型中「同步中」即此含义

## 7. Project 数据模型

```ts
interface Project {
  id: string;
  name: string;                       // 如「6 模型视频对比」
  status: 'active' | 'draft' | 'archived';   // 对应原型页签
  items: ContentItem[];
  layout: { rows: number; cols: number } | 'auto';
  settings: {
    aspectRatio: '16:9' | '9:16' | '1:1' | 'original' | 'custom';  // 全局比例
    customRatio?: { w: number; h: number };
    showTitles: boolean;              // 标题显隐（全局，仅标题输入框）
    showInfo: boolean;                // 属性信息显隐（全局，标题下方信息行：文件名/大小/比例/操作）
    loop: boolean; muted: boolean; playbackRate: number;
  };
  createdAt: string; updatedAt: string;
}
```

MVP 阶段默认单项目 + 草稿/归档状态；多项目列表页第二阶段补（页签先支持切换与新建）。

## 8. 存储与 API 演进

- 目录：`data/projects/[id]/manifest.json` + `data/projects/[id]/files/`；`data/manifest.json`（v1）由迁移脚本一次性搬入默认项目
- **迁移**：服务端启动时检测 v1 清单 → 自动创建默认项目、搬移文件、写 v2 清单、v1 文件改名备份；一次性、幂等
- 并发不变量延续：所有读-改-写临界区必须包 `withManifestLock`；锁升级为按 projectId 维度
- API 面（在现有风格上扩展）：
  - `GET/POST /api/projects`（列表/新建）、`PATCH/DELETE /api/projects/[id]`（改名/状态/删除）
  - `GET /api/projects/[id]/items`（清单）、`POST .../upload`（file + order）、`PATCH .../items/[itemId]`（标题/比例/排序）、`DELETE .../items/[itemId]`
  - `PATCH .../layout`、`PATCH .../settings`（全局比例/标题与属性显隐/播放设置）
  - `GET /api/files/[name]` 保留并升级：按项目隔离路径 + 对 `.html` 强制安全响应头（见 §11）
- 上传校验延续严格风格：kind 由服务端按 MIME + 扩展名双判，HTML 限 ≤10MB

## 9. Video 功能逻辑

- 语义调整：「同时播放」弱化为**批量控制**——全部播放 / 全部暂停 / 全部重新开始（统一回零后起播）/ 循环 / 全局静音 / 全局开声 / 播放速度（0.5/1/1.25/1.5/2），只作用于 kind=video 的 Item
- 不做严格时间轴同步：长度不同的视频各自独立播放；开启循环后各自播完自行重头
- 单卡控制（激活态）：播放/暂停、静音、最大化、替换、删除
- 技术要点延续：`loop`/`muted` 直写 DOM 属性、批量控制用 refs 遍历、播放动作在用户点击后发生

## 10. HTML 功能逻辑

- 展示即运行：iframe 加载服务端 URL，页面自动执行（CSS 动画、JS 交互），**不做**动画同步/暂停/时间轴控制
- 状态机：`loading`（iframe 挂载中，卡片显示 spinner）→ `ready`（onload）→ `error`（onerror 或超时 15s，显示错误态 + 重试）
- 卡片信息条：文件名 + 状态点（复用原型 3 的状态 chip 样式）
- 替换/删除与视频一致；替换后 iframe key 变更强制重挂载

## 11. HTML Sandbox 安全方案（重点）

对应需求梳理第十四节七问：

1. **如何加载**：上传后存 `files/`，iframe `src=/api/projects/[id]/files/[name]`，不用 `srcdoc`（大文件与相对资源不友好）；响应带 `Cache-Control: no-store`
2. **CSS 隔离**：iframe 天然文档级隔离，主应用样式不会互相污染
3. **JS 隔离**：sandbox 属性 `allow-scripts`（页面要跑 JS）但**绝不给 `allow-same-origin`**——去掉后 iframe 内文档为 opaque origin，无法读取主站 cookie / localStorage / DOM
4. **主应用防污染**：除 sandbox 外，服务端对 `.html` 直链响应强制 `Content-Security-Policy: sandbox allow-scripts` + `Content-Disposition: inline; filename=sandbox.html`（防在主域新标签直接打开时执行任意脚本的同源风险）+ `X-Content-Type-Options: nosniff`
5. **sandbox 限制清单**：允许 `allow-scripts`；禁止 `allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`（MVP 不需要表单提交）、`allow-downloads`
6. **本地 HTML 资源路径问题**：单文件自包含是 MVP 前提（AI 生成的 HTML 绝大多数内联 CSS/JS）；导入时检测 `<img src="./xxx"`、`<link rel=stylesheet href=` 等外链相对引用，向用户提示「该页面可能显示不完整」
7. **依赖本地 CSS/JS/图片**：MVP 不支持（提示明确报错原因）；第二阶段支持 zip 包解压到 item 目录，iframe 指向目录内 index.html，相对路径自然可用

外链（http/https CDN）资源默认**允许**（AI 页面常用 tailwind CDN / 字体），风险已在文档列明；后续可在设置中加「禁用外链」开关（CSP 实现）。

## 12. 布局系统

- **Auto Layout**（默认）：按 `count` 求近方形矩阵——`cols = ceil(sqrt(count))`，`rows = ceil(count / cols)`；同屏尺寸修正：窄屏（<768px）时 `cols = min(cols, 2)` 竖向堆叠；用户任何手动选择都会覆盖 auto 并记住
- **Manual Layout**：保留现有矩阵选择器（含质数补位矩阵）；容量约束 `rows*cols >= count` 依旧服务端强校验
- 数量超过矩阵容量：自动扩位（沿 v1 行为），并给「已自动扩展为 N×M」toast（通道 id 复用）
- 网格渲染：CSS Grid `repeat(cols, minmax(0,1fr))`，卡片高度由比例系统决定（见 §13）

## 13. 内容比例系统

- 全局 `settings.aspectRatio` 影响所有卡片框；单卡 `aspectRatio` 覆盖全局；`original` = 16:9 容器 + contain（v1 行为），`custom` 弹出 w/h 输入
- **铁律不变**：内容永远 `object-contain`，比例只控制**卡片框**——竖版视频进 16:9 框会有留白，留白由底色吸收；「模糊背景填充」列为第二阶段增强
- 实现：卡片内容区 `aspect-ratio: w/h` 样式（行内 style），HTML iframe 同样受框约束（`overflow: hidden` + 内部滚动）

## 14. Drag & Drop 排序

- `@dnd-kit/core` + `@dnd-kit/sortable`，网格横向排序策略（`rectSortingStrategy`）
- 拖拽手柄：卡片左上角位置角标兼作手柄；拖拽中卡片 `scale-[1.02]` + 阴影，落点占位虚线框
- 落下后：乐观更新前端 order → `PATCH items/reorder`（body: `orderedIds`）→ 失败回滚 + 错误 toast（通道 id `reorder`）
- 与文件拖入导入的冲突消解：从外部拖文件 = 导入（dataTransfer 有 files），从卡片拖动 = 排序；两者事件源不同，不冲突

## 15. 全局状态设计

- 引入 zustand：`useWorkspaceStore` 持有 `{ projectId, items, layout, settings, mode: 'studio' | 'focus', theme }`
- 服务端仍是唯一事实源：store 仅做乐观更新缓存，所有变更走 API 后以响应回填（延续 v1「响应即回填」模式）
- 模式切换（Studio↔Focus）只改 store.mode，不触碰 items/播放状态；视频元素保持挂载（Focus 与 Studio 复用同一组件树，仅壳层条件渲染），杜绝切换时播放中断
- localStorage 只存 UI 偏好（mode、sidebar 展开、主题），不存业务数据

## 16. 主题系统

- `next-themes`，`attribute="class"`，`defaultTheme="dark"`，顶栏明暗切换按钮（Sun/Moon）
- DESIGN.md 令牌映射到 shadcn CSS 变量（globals.css）：
  - 暗色：background `#131313` · card `#1c1b1b` · popover `#201f1f` · primary `#adc6ff`(文字 `#002e69`) · 边框 `#414755` · 前景 `#e5e2e1`
  - 亮色：background `#F5F5F7` · card `#ffffff` · primary `#005bc1`(文字白) · 前景 `#1d1d1f`
  - 品牌 accent 从 violet 渐变迁移到 precision blue（M3 pairing）；状态色：绿=就绪、琥珀=处理中、蓝=激活
- 字体：Inter（正文/标题）+ JetBrains Mono（文件名、DOM 数等技术标签），经 next/font 接入
- `color-scheme` 随主题切换，滚动条防抖规则（`scrollbar-gutter: stable`）在双主题下保留

## 17. 实施路线（每步可独立交付）

| Step | 内容 | 状态 |
|---|---|---|
| 1 | 蓝图本文 + 产品更名 OmniCompare + 仓库更名 | 完成（仓库已更名 omnicompare） |
| 2 | 双主题落地：DESIGN token → globals.css、next-themes、顶栏切换按钮、现有页面全面主题化（去硬编码 zinc/violet） | 完成（Token 基建先行，硬编码清扫与 Tailwind 扫描排除随 Step 4 补完） |
| 3 | schema v2 + v1→v2 迁移脚本 + items API 重构（id 锚点、order） | 完成（project-store.ts 存储核心 + 幂等迁移 + 按项目锁；v1 端点经 video-store 门面兼容；新增 /api/projects 全套 11 端点；HTML 安全响应头随文件路由先行落地；v1 47 项 + v2 38 项测试全绿） |
| 4 | Studio/Focus 双模式壳（左侧栏 + 顶栏改造 + 模式切换不丢状态） | 完成（含精简侧栏：项目卡/视图导航/窗格列表定位高亮；项目卡动态化随 Step 8 接活） |
| 5 | HTML 类型：上传校验、sandbox iframe 渲染、状态机、安全响应头 | 完成（v1 门面扩展 kind/html 视图 + writeManifest 集中式孤儿清理；前端 iframe sandbox=allow-scripts + loading/ready/error 状态机（15s 超时+重试）+拖拽护盾；v1 对抗 47→71 项全绿；锁队列挂 globalThis 防 dev 模式多实例丢失） |
| 6 | 布局升级：Auto Layout + 拖拽排序（dnd-kit） | 完成（auto/manual 双模式：auto 按数量近方阵、窄屏收窄 2 列，手动选择覆盖并记住；v1 视图透传 layoutMode 向后兼容；dnd-kit rectSortingStrategy 拖拽排序 + 位置角标兼手柄，v1/v2 reorder 端点严格排列校验；v1 对抗 71 项两轮全绿，浏览器端到端拖拽持久化与标题跟随验证通过） |
| 7 | 比例系统 + 标题显隐 + 播放速度 | 完成（全局 settings API + 单卡覆盖：卡片框由行内 aspect-ratio 控制、内容恒 contain；original/custom 回落 16:9 容器；标题显隐全局开关隐藏标题与信息行；速度 0.5~2× 直写 DOM；loop/muted/速度/比例/标题显隐全部迁入服务端 Project.settings（localStorage 仅留 UI 偏好）；发现并修复 normalizeItem 读取归一化丢失 aspectRatio 的 bug；对抗 71→95 项全绿，浏览器端到端验证通过）。**后续细化（D9）**：标题与属性信息拆分为两个独立开关（settings.showInfo），并移除导航栏「已放置」计数徽标；对抗 95→97 项全绿 |
| 8 | 项目状态（草稿/归档）+ 多项目页签 + 空状态引导页（遵循 D7：简单提示，不做花哨插画） | 完成（v1 全端点支持 `?project=` 多项目（缺省默认项目零改动兼容，404/400 严格校验）；顶栏项目切换器按状态分组 + 新建项目弹窗（创建即切换）；侧栏项目卡动态化：改名/状态切换/删除（默认项目 403 保护，删除当前项目自动回落）；空项目显示简单文字引导页（D7）；内容处理中禁止切换项目防在途请求串项目；本地记住当前项目且被删后自动回落；对抗 97→110 项全绿（新增 §17 多项目隔离 13 项），浏览器端到端验证通过） |
| 9 | 打磨与文档：README/PROJECT 更新、对抗测试脚本扩展 HTML/排序用例 | 待做 |

## 18. MVP 功能清单

**MVP 必须**（Step 3~8 全部）：视频 + HTML 双类型导入（点击/拖拽/批量）、Auto + Manual 布局、批量播放控制 + 速度、单卡激活控制（播放/静音/最大化/替换/删除）、拖拽排序、全局+单卡比例、标题编辑与全局显隐、Studio/Focus 双模式、暗/亮双主题、草稿/归档、服务端多项目持久化、HTML sandbox 安全方案。

**第二阶段**：图片/SVG 类型、zip HTML 资源包、资产库、模糊背景填充、自定义比例 UI、移动端编辑、导出对比快照。

**后续扩展**：云端账号与云项目、评分/标注（benchmark）、对比报告导出、API 自动抓取模型输出。

## 19. 技术难点与风险

1. **HTML 沙箱逃逸**（高）：严禁 `allow-same-origin` + 服务端 CSP 双保险；对抗测试需包含「iframe 内尝试读 parent」用例
2. **v1→v2 迁移**（中）：一次性脚本要幂等，迁移前备份 `data/`；测试环境先演练
3. **模式切换状态保持**（中）：Focus/Studio 必须复用同一组件树仅换壳层，否则视频重载、播放中断（历史教训：DOM 属性直写依赖元素不重建）
4. **拖拽排序与矩阵容量交互**（中）：order 连续性（0..n-1 无空洞）由服务端保证，reorder 后重算
5. **双主题回归量**（低但琐碎）：本项目曾以硬编码 zinc/violet 实现，主题化要逐类清扫，测试双主题 × 双模式四种组合
6. **多标签页并发**（低）：延续进程内锁 + 响应回填；出现真实冲突场景时再引入 version 字段乐观锁
7. **Tailwind 自动扫描污染**（已修复，记入历史教训）：`upload/` 下的 Stitch 原型 HTML 含 `bg-[url('placeholder')]` 等非法任意值类，会被 Tailwind v4 自动源码扫描生成进 CSS 导致构建 500；已在 globals.css 用 `@source not "../../upload"` 排除。后续引入含类名的静态资产（原型/设计稿导出）时，必须同样排除或放入已忽略目录

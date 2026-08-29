# 踩坑记录与经验沉淀（LESSONS-LEARNED）

> 本文档专门沉淀 OmniCompare（前视频墙）开发过程中**真实踩过的坑**：现象是什么、根因在哪、怎么解决的、以后如何预防。与 [BLUEPRINT.md](BLUEPRINT.md)（产品决策 D1~D12）和 [PROJECT.md](../PROJECT.md)（架构与使用）互补：蓝图记「决定做什么」，本文记「错了什么、学到了什么」。
>
> **维护约定**：每修一个非平凡 bug 就追加一条；按分类归档；已确立为规则的条目迁移到「铁律清单」；条目只增不改（除非原记录有误），保证历史可信。

---

## 目录

- [一、布局稳定性：「一缩一缩」震动四部曲](#一布局稳定性一缩一缩震动四部曲)
- [二、数据一致性与并发](#二数据一致性与并发)
- [三、构建与工具链](#三构建与工具链)
- [四、测试环境的盲区](#四测试环境的盲区)
- [五、Git 与仓库卫生](#五git-与仓库卫生)
- [六、安全红线](#六安全红线)
- [七、React / Radix 细节坑](#七react--radix-细节坑)
- [八、元经验（方法论）](#八元经验方法论)
- [九、可复用验证资产](#九可复用验证资产)
- [十、铁律清单（速查）](#十铁律清单速查)

---

## 一、布局稳定性：「一缩一缩」震动四部曲

同类症状「一缩一缩」，前后出现了 **四个不同根因**，跨越三轮用户反馈才全部根治。这是本项目最有价值的教训集合。

### 1.1 页面高度跨视口 → 滚动条出现/消失（第一类横移）

- **现象**：切换内容数量（如 3↔9）时整个页面水平移动一下。
- **根因**：内容变多 → 页面高度超过视口 → 垂直滚动条出现 → 视口可用宽度减少约 15px → `mx-auto` 居中容器整体横移。
- **解决**：`globals.css` 给 `html` 加防抖三件套，滚动条槽位常驻，宽度永不变化：

```css
html {
  overflow-y: scroll;          /* 垂直滚动条强制常驻 */
  scrollbar-gutter: stable;    /* 为滚动条保留固定槽位 */
  color-scheme: dark;          /* 滚动条配色跟随主题 */
}
```

- **附带教训**：同一时期还有两个叠加因素——① 布局类 toast 无去重 id 逐条堆叠改变文档流；② 导航栏「已放置 x/x」「行×列」里的数字非等宽，数字变化时兄弟元素被挤动。修复：toast 按通道固定 sonner id；数字统一 `tabular-nums` + `min-w-[Nch]` 定宽。

### 1.2 骨架屏与真实卡片高度差（走了弯路的方案）

- **现象**：切换项目时内容区先塌一下再撑开。
- **当时方案**：`setLoading(true)` 显示骨架屏。骨架（aspect-video + 标题条）与真实卡片（比例框 + 标题 + 信息行）高度不同，形成「内容 → 骨架 → 新内容」两次跳变。
- **改进**：废弃骨架屏，改用 `switching` 过渡态（旧内容渐隐 + 禁交互，新数据一次性替换后渐显）——但这**只解决了纵向高度差**，后面 1.3/1.4 证明它治不了真正的病。教训：**过渡动画只能掩盖跳变，不能消除位移源**。

### 1.3 顶栏 flex-wrap 行数跳变（纵向震动真凶）

- **现象**：点击「默认项目/测试项目」切换时，主体内容被推上推下；左侧栏不动。
- **根因**（浏览器采样实测铁证）：顶栏用了 `flex-wrap`，播放按钮组随项目内容显隐（`hasVideo` 派生）。含视频项目按钮多 → 顶栏换行成 2 行（115px）；纯 HTML 项目按钮少 → 收成 1 行（65px）。**sticky 顶栏高度变化直接把下方主体推上推下**。1024×700 视口复现，1440 宽不复现（不换行）——解释了为什么此前多轮修复「无效」：修的都不是这一层。
- **解决**：顶栏重构为**固定两行结构**——第一行品牌 + 项目切换器 + 使用须知书本按钮 + 主题切换；第二行功能按钮 `flex-nowrap + overflow-x-auto + no-scrollbar`（窄屏横向滑动而不是换行），配 `[&>*]:shrink-0` 防压缩。行高从此恒定 113px。

### 1.4 Radix 弹层滚动条间隙补偿（横向震动真凶，最隐蔽）

- **现象**（用户第 3 次反馈的关键观察）：点「默认项目」时①主体内容收缩②左导航和顶栏不动③**右上角主题切换按钮也跟着收缩**。「主题按钮也缩」说明是**整片右侧区域被横向压缩**，与 1.3 的纵向跳动症状不同。
- **根因链**（源码级实锤）：Radix modal 弹层（DropdownMenu/Dialog/AlertDialog 默认 modal）打开时经 `react-remove-scroll` 挂载滚动锁，`react-remove-scroll-bar` 的 `getGapWidth()` 测量 `window.innerWidth - documentElement.clientWidth`（= 滚动条宽度），然后给 `body[data-scroll-locked]` 注入 `margin-right: {gap}px !important` 做「间隙补偿」。这个机制是为「锁滚动时滚动条会消失」的场景设计的；而本项目 `html` 强制滚动条常驻（1.1 的修复），滚动条**从不消失** → 补偿纯有害 → 每次弹层开/关，body 被压窄/弹回 15~17px，居中容器重新居中，右缘元素位移最明显。与用户描述逐字吻合。
- **解决**：`globals.css` 追加覆盖（同为 `!important` 时靠特异性 0-1-2 压过注入样式的 0-1-1）：

```css
html body[data-scroll-locked] {
  margin-right: 0 !important;
  padding-right: 0 !important;
}
```

弹层的滚动锁定功能本身保留不受影响。
- **为什么此前自动化测不出**：无头浏览器是 **overlay 滚动条**（不占布局宽度），gap 恒 0，Radix 注入 0px，无位移。修复验证用 `scripts/test-shrink.sh` 以 `Object.defineProperty` 桩化 `window.innerWidth = clientWidth + 17` 模拟经典滚动条环境，修复前后同一脚本对比出位移→零位移。详见 [四、测试环境的盲区](#四测试环境的盲区)。

### 1.5 布局稳定性防御规则（由此确立的铁律）

1. 涉及视口宽度的东西必须恒定：滚动条槽位常驻、弹层间隙补偿归零、toast 不改变文档流。
2. sticky 顶栏高度必须恒定：功能按钮区永不换行（横向滚动代替换行），按钮显隐只发生在**行内**。
3. 动态数字一律 `tabular-nums` + `min-w-[Nch]`。
4. 切换内容的过渡只做透明度，不做高度/宽度变化的中间态。

---

## 二、数据一致性与并发

### 2.1 读-改-写并发丢失（lost update）

- **现象**：并发上传时部分文件静默丢失，磁盘出现孤儿文件。
- **根因**：多个请求同时「读清单 → 修改 → 写回」，后写者覆盖先写者的修改。
- **解决**：`withManifestLock` 单进程互斥队列，所有读-改-写临界区串行化；升级到多项目后演变为 `withProjectLock`（按项目维度互斥）。dev 模式下模块可能被重复求值导致锁实例分裂，锁队列挂到 `globalThis` 上（Next.js 生态处理 dev HMR 的惯用法，Prisma 同款）。

### 2.2 归一化函数吞掉新字段（最有代表性的隐性 bug）

- **现象**：单卡比例覆盖落库后，读回来永远是 null，设置丢失。
- **根因**：`normalizeItem` 是清单读取的必经之路，其实现硬编码 `aspectRatio: null`——写入是好的，**读取归一化时被剥掉**。
- **解决**：归一化时校验并保留合法值。
- **教训**：每给 schema 加字段，必须检查**所有** normalize/serialize/clone 路径；「写入正常、读回丢失」优先怀疑读取侧的归一化白名单。

### 2.3 缩减确认框计数用错判断依据 → 静默丢视频

- **现象**：视频不连续放置时缩减数量，确认框说删 1 个实际删 2 个（或反之）。
- **根因**：用 `filledCount`（已放置总数）做差值，而缩减删的是**位置 ≥ n 的槽**，应该数 `slots.slice(n)` 里实际有内容的个数。
- **教训**：删除类确认框的计数必须数「将被删除的实际对象」，不能用任何总量差值近似。

### 2.4 参数校验的静默兜底

- **现象**：上传 API 缺 slot 参数时文件全部落到位置 0。
- **根因**：`Number(null) === 0`，JS 弱类型把「缺失」悄悄变成「合法的 0」。
- **解决**：严格 `/^\d{1,2}$/` 正则校验，非法直接 400。
- **教训**：`Number()`/`parseInt()` 对 null/undefined/空串都有静默值；入参校验宁可错杀（400），不可兜底（200 但落到错误位置）。

### 2.5 「丢更新」虚警：并发测试断言要写确定性形式

- **现象**：并发上传测试偶发失败，疑似锁失效。
- **排查**：agent-browser + 临时探针证明锁串行化始终正确；真身是**紧凑左填语义** × 并发到达顺序——后到的请求合法地替换了先到请求落在同槽位的内容，属于文档化语义，不是 bug。
- **教训**：并发测试断言应写**不变量**（如「清单条目 ↔ 磁盘文件 1:1」「order 恒 0..n-1 无空洞」），不写依赖到达顺序的具体结果。

### 2.6 数据层不变量（延续至今）

1. 所有读-改-写临界区必须包项目锁；
2. 清单写盘为原子写（临时文件 + rename，临时名加随机后缀防踩踏）；
3. 清单条目 ↔ 磁盘文件恒 1:1（写盘前 diff 新旧引用，集中清理孤儿，任意写路径生效）；
4. `order` 恒紧凑 0..n-1；
5. v1 API 是 v2 数据上的兼容门面，两端点行为必须一致（对抗脚本里有 v1↔v2 一致性断言）。

---

## 三、构建与工具链

### 3.1 Tailwind v4 自动扫描污染 → 构建期 500

- **现象**：把 UI 原型 HTML 放进 `upload/` 目录后，`next dev` 直接 Module not found / 500。
- **根因**：Tailwind v4 自动扫描项目内所有源文件，原型 HTML 里的 `bg-[url('placeholder')]` 非法任意值类被生成为 CSS 引用不存在的资源，构建期爆炸。
- **解决**：`globals.css` 用 `source(none)` + `@source` 白名单精确圈定扫描范围，`upload/` 永不在扫描内。
- **教训**：引入任何含类名的静态资产（原型/设计稿导出/文档示例）前，先确认 Tailwind 扫描范围是否将其排除。

### 3.2 Turbopack 持久缓存吞掉 globals.css 增量修改

- **现象**：改了 `globals.css`，`touch` 文件、重启 dev 均无效——chunk 哈希不变、产物里没有新规则，表现为「修复没生效」。
- **根因**：Turbopack 持久缓存未感知全局 CSS 增量。
- **解决**：`rm -rf .next` 后重启即生效。
- **教训**：**改全局 CSS 验证时若产物异常，先清 `.next` 再怀疑自己的代码**。这条能省掉大量「我明明改了为什么没用」的排查时间。

---

## 四、测试环境的盲区

> 本章核心一句话：**自动化测试绿灯 ≠ 真实环境没问题**。本项目两大「修了三次才好」的坑，都卡在无头环境盲区上。

### 4.1 无头浏览器是 overlay 滚动条 → 经典滚动条位移无法复现

- **盲区**：Linux 无头 Chrome 默认 overlay 滚动条（不占布局宽度），`innerWidth === clientWidth` 恒成立。因此 1.1 的滚动条位移、1.4 的 Radix gap 补偿在自动化里 gap 恒 0，**永远无法复现**。
- **方案**：`scripts/test-shrink.sh` 用 `Object.defineProperty(window, 'innerWidth', ...)` 桩化宽度为 `clientWidth + 17`，人为制造经典滚动条环境；再采样 body margin-right、关键元素 left/Top 对比修复前后。
- **通用化**：凡是「宽度/滚动条相关」的布局 bug，先问自己测试环境的滚动条模式；必要时桩化 API 制造环境。

### 4.2 agent-browser 多文件注入 File size=0

- **盲区**：Playwright `setInputFiles` 注入多文件时，页内拿到 `File.size === 0`（fetch 上传抛错）；单文件正常。
- **方案**：页内 `DataTransfer` + 真实字节构造 `File` 对象完成多文件注入测试。真实用户浏览器不受影响，属测试工具限制。

### 4.3 Radix 弹层需要真实指针事件序列

- **盲区**：`element.click()` 等程序化点击无法触发 Radix DropdownMenu（它监听真实 `pointerdown` 且有交互检测）。
- **方案**：用 `mouse move → down → up` 坐标序列模拟真实指针。

### 4.4 水合警告：门控只做了一半

- **现象**：控制台 hydration mismatch 警告。
- **根因**：主题按钮的**图标**做了 `themeMounted` 门控防水合不一致，但 **title 属性**漏了门控——服务端 `resolvedTheme=undefined` 渲染暗色文案，客户端 next-themes 首帧同步读 localStorage 渲染亮色文案。
- **教训**：`suppressHydrationWarning` 只覆盖元素自身属性、不覆盖子组件；凡依赖浏览器态（主题/窗口/本地时间）渲染的**每一个属性**都要统一门控到挂载后。

---

## 五、Git 与仓库卫生

### 5.1 历史提交含隐私数据

- **现象**：准备开源推送时发现旧历史提交里含 `.env`、用户视频、测试素材——文件当前删了，历史还在。
- **解决**：`git checkout --orphan` 压缩为单一干净根提交，旧 main 删除。比 `filter-branch`/BFG 简单可靠（代价是丢历史，本项目可接受）。
- **预防**：`.gitignore` 先行清单化（`data/`、`.env`、`/upload/`、`/data-backup*/`、测试二进制、会话产物）；`git add -A` 前先 `git status` 审查。

### 5.2 沙箱自动提交器误收素材（UUID 提交现象）

- **现象**：git log 中出现 UUID 信息的自动提交，把 `upload/` 用户素材、原型 zip 收进了库；且出现过「恢复会话时以为代码没提交，实际已被自动提交收走」。
- **规则**：① 每次恢复会话**先 `git log` 核对状态**，勿按摘要假设；② 发现误收用 `git reset --soft <远程HEAD>` 软回退，把 `upload/` 整体移出跟踪并 `.gitignore` 根治；③ UUID 提交若内容正确，`amend` 成规范提交消息即可。

### 5.3 凭据卫生

- 推送用 token 嵌 URL 一次性使用，**推送后立即 `git remote set-url` 脱敏**；用 `git ls-remote`/API 验证远程状态。凭据经聊天传输、权限大，提醒用户及时轮换。

---

## 六、安全红线

### 6.1 iframe sandbox：allow-scripts 绝不配 allow-same-origin

- 用户上传的 HTML 会在 iframe 里执行 JS。`allow-scripts + allow-same-origin` 同时存在时，恶意页面可移除自身 sandbox 读主站 cookie/localStorage/DOM——**等于没沙箱**。
- 双保险实现：
  - iframe 属性：`sandbox="allow-scripts"`（仅此一项）；
  - 服务端对 `.html` 直链响应强制 `Content-Security-Policy: sandbox allow-scripts` + `X-Content-Type-Options: nosniff` + `Cache-Control: no-store` + `Content-Disposition: inline; filename=sandbox.html`（防在主域新标签直接打开）。
- 验证手段：页面试图访问 `iframe.contentDocument` 被跨源阻断。

### 6.2 上传校验双判 + 白名单

- 类型由**服务端**按 MIME + 扩展名双判（客户端校验可绕过）；HTML 限 ≤10MB；路径穿越（`../`）入参一律拒绝。

---

## 七、React / Radix 细节坑

### 7.1 effect 内同步 setState 被 react-compiler lint 禁止

- **现象**：想在 effect 里根据 prop 变化 setState，被 lint 拦截（effect 同步 setState 会级联渲染）。
- **方案**：改用**渲染期重置模式**——`const [prev, setPrev] = useState(prop); if (prev !== prop) { setPrev(prop); ... }`（React 官方认可的 adjust-state-during-render 模式）。文件内 `prevFilename`、`refreshSignal`（刷新全部 iframe）均用此模式。

### 7.2 派生态优于手动模式开关

- 顶栏按钮组显隐曾担心需要「用户选模式」，最终确认全部由 `hasVideo = slots.some(s => !!s.video)` **派生**：全视频项目显示播放组、纯 HTML 项目主动作变「刷新全部」、空项目只剩布局/导入。内容驱动零配置、不会状态不一致；用户在切换器角标（🎬/`</>` + 数量）获得形态预告。**能用派生值就不要冗余状态**。

### 7.3 sonner toast 堆叠

- 高频操作（切布局/批量导入）不固定 id 时 toast 逐条堆叠遮挡 UI。按**通道**固定 id（`layout`/`import`/`reorder`…），同通道自动替换，配 `Toaster` 贴底 + `visibleToasts=2` 全局兜底。

### 7.4 Radix modal 弹层与常驻滚动条的机制冲突

- 见 1.4。本质：Radix 的滚动锁假定「锁定 → 滚动条消失 → 需要补宽度」，与「滚动条强制常驻」策略天然冲突。凡同时使用 `scrollbar-gutter: stable` 与 Radix modal 组件的项目都会遇到，`body[data-scroll-locked]` 覆盖是通用解。

---

## 八、元经验（方法论）

1. **用户观察是最有价值的诊断线索。**「主题按钮也跟着收缩」一句描述把三轮没修好的震动从「纵向高度问题」扭转为「横向宽度问题」。用户看到的现象细节（谁动、谁不动、什么方向）胜过盲目的代码走查。
2. **自动化绿灯 ≠ 没有 bug。**无头环境的 overlay 滚动条让两大位移 bug 完全不可复现。对环境敏感的问题要主动问「我的测试环境和用户环境差在哪」，必要时桩化 API 制造环境（4.1）。
3. **分清「掩盖症状」和「根治根因」。**骨架屏、opacity 过渡都是掩盖；根因分别是行数跳变（1.3）和间隙补偿（1.4）。同一症状可以有多个独立根因叠加（本项目四部曲），修掉一个不等于全好——**每轮反馈都当作新线索重新归因，不要预设「上次没修干净」**。
4. **修复必须附带可复用的回归资产。**`test-shrink.sh`（桩化滚动条）、对抗脚本 110 项 + 冒烟 38 项，让每个修过的坑从此有守门员。
5. **小批编辑 + 立即验证。**MultiEdit 非原子（失败时已应用部分不回滚），批量改代码一律小步单条 Edit、每步验证。
6. **恢复会话先核对 git 状态**（5.2），勿按记忆/摘要假设。
7. **环境产物异常先清缓存再怀疑代码**（3.2 Turbopack）。
8. **不变量思维**：数据正确性不靠逐条测试，靠少数强不变量（2.6）+ 每次测试断言这些不变量。

---

## 九、可复用验证资产

| 资产 | 用途 |
|---|---|
| `scripts/api-adversarial-test.sh` | v1 API 对抗测试 110 项（含并发/校验/多项目隔离/设置），改动数据层后必跑 |
| `scripts/api-v2-smoke-test.sh` | v2 API 冒烟 38 项 |
| `scripts/test-shrink.sh` | 经典滚动条环境模拟（桩化 innerWidth），弹层/切换零位移回归专用 |
| `scripts/repro-concurrent.sh` | 并发上传一致性复现 |
| `scripts/restore-demo-state.py` | 恢复默认项目演示态（6 视频 2×3 + 演示设置），测试跑完后使用 |
| `scripts/setup-demo-mixed.sh` / `setup-demo-html-project.py` | 混排演示（4 视频+2 HTML）/「测试项目」（6 个模仿 HTML 页），幂等可重跑 |
| `scripts/gen-test-videos.sh` | 生成各分辨率测试视频 |

---

## 十、铁律清单（速查）

- [ ] 全局 CSS：`html { overflow-y: scroll; scrollbar-gutter: stable }` + `html body[data-scroll-locked] { margin-right:0 !important; padding-right:0 !important }`
- [ ] 顶栏两行恒高；功能行 `flex-nowrap + overflow-x-auto + no-scrollbar`；动态数字 `tabular-nums + min-w-[Nch]`
- [ ] toast 按通道固定 id；Toaster 贴底 `visibleToasts=2`
- [ ] 清单读写：项目锁 + 原子写 + 孤儿清理 + order 紧凑；入参严格校验不静默兜底
- [ ] iframe：`sandbox="allow-scripts"`，绝不加 `allow-same-origin`；服务端 CSP 双保险
- [ ] Tailwind 扫描范围排除 `upload/` 等含类名静态资产目录
- [ ] 改全局 CSS 后产物异常 → 先 `rm -rf .next`
- [ ] 涉宽度/滚动的 bug：先确认测试环境滚动条模式，必要时桩化 `window.innerWidth`
- [ ] 依赖浏览器态渲染的每个属性（含 title）统一 `themeMounted` 类门控
- [ ] 新增 schema 字段：检查所有 normalize/serialize 路径
- [ ] 推送凭据：一次性使用，推后立即 `set-url` 脱敏
- [ ] 批量编辑：小步单条 + 每步验证

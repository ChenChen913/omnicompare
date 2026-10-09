import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* 构建期不再豁免类型错误：类型门禁一旦放行，CI 的 tsc 就成了唯一防线，
     本地/第三方构建会带着类型错误直接产出产物。CI 仍会独立跑 tsc 与 eslint。 */
  /* 2026-10 重新启用 StrictMode（曾因早期测量类 effect 不耐受双执行而关闭）：
     拆分后的 effect 已全部幂等（测量重入无害、初始化 fetch 有 cancelled 标志、
     计时器 cleanup 正确配对），双执行暴露不出新问题；保留 React 官方的
     开发期防线（effect 副作用/不可重入 bug 的免费体检）。 */
  reactStrictMode: true,
};

export default nextConfig;

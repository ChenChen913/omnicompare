import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* 构建期不再豁免类型错误：类型门禁一旦放行，CI 的 tsc 就成了唯一防线，
     本地/第三方构建会带着类型错误直接产出产物。CI 仍会独立跑 tsc 与 eslint。 */
  reactStrictMode: false,
};

export default nextConfig;

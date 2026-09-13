import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 门禁强度说明（历史问题：这里曾把几十条规则整片关闭，包括 no-undef / no-unreachable /
 * no-unused-vars / react-hooks/exhaustive-deps，于是 "eslint 零错误" 几乎不携带信息量）。
 * 现在的取舍：
 * - 真问题（不可达代码、未使用变量、未定义变量、prefer-const）保持开启，违规即失败或告警；
 * - 与项目既有风格冲突的规则保留关闭，并在行内写明原因，避免后来者"顺手再关一批"。
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // —— 正确性：保持开启 ——
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-constant-condition": "warn",
      "prefer-const": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // 依赖数组漏项是真实 bug 来源（本项目大量使用 useCallback/useEffect），保留告警
      "react-hooks/exhaustive-deps": "warn",

      // —— 与项目风格冲突，明确保留关闭 ——
      // 与 shadcn/ui 生成代码的既有写法冲突（大量 any 与 as 断言）
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",
      // 项目有意使用原生 <img>/<video>（object-contain 不裁切是产品铁律，next/image 会介入尺寸处理）
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
      // 中文文案里出现引号是常态，转义规则不适用于本项目的写作风格
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      // 空 catch 块在本项目是有意的"失败静默"（如 localStorage 在隐私模式下抛错）
      "no-empty": "off",
      "no-console": "off",
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"],
  },
];

export default eslintConfig;

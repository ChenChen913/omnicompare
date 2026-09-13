/**
 * 死代码可达性分析：从 Next.js 应用入口（src/app 下的所有路由/布局文件）出发，
 * 沿 import 图标记可达文件，输出不可达的模块。只处理项目内相对/别名导入，忽略裸包名。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const srcDir = join(root, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(srcDir);
const fileSet = new Set(files.map((f) => resolve(f)));

function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else return null;
  const candidates = [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidates) {
    const r = resolve(c);
    if (fileSet.has(r)) return r;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

const graph = new Map();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const deps = new Set();
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const r = resolveSpec(spec, f);
    if (r) deps.add(r);
  }
  graph.set(resolve(f), deps);
}

// 入口：src/app 下的一切（Next 的约定式路由，均可能被框架直接加载）
const entries = files.filter((f) => relative(srcDir, f).startsWith('app' + (process.platform === 'win32' ? '\\' : '/')) || relative(srcDir, f).startsWith('app/'));
const reachable = new Set();
const stack = entries.map((f) => resolve(f));
while (stack.length) {
  const cur = stack.pop();
  if (reachable.has(cur)) continue;
  reachable.add(cur);
  for (const d of graph.get(cur) ?? []) stack.push(d);
}

const unreachable = files
  .map((f) => resolve(f))
  .filter((f) => !reachable.has(f))
  .map((f) => relative(root, f).replace(/\\/g, '/'))
  .sort();

console.log(`源文件总数: ${files.length}`);
console.log(`入口（src/app）: ${entries.length}`);
console.log(`可达: ${reachable.size}`);
console.log(`不可达: ${unreachable.length}`);
console.log('---');
let lines = 0;
for (const u of unreachable) {
  const n = readFileSync(join(root, u), 'utf8').split('\n').length;
  lines += n;
  console.log(`${String(n).padStart(5)}  ${u}`);
}
console.log('---');
console.log(`不可达代码合计 ${lines} 行`);

// 极简构建：src/ → lib/
// host 半边是 ESM；client 半边本身就是 __ModuleLoader__ 格式，直接复制即可。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 本文件位于 scripts/，项目根是它的上一级
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'src')
const lib = path.join(root, 'lib')
fs.mkdirSync(lib, { recursive: true })

// host 与 client 都是成品，直接复制（client 无需再包装）
for (const f of ['aliyun.js', 'usage.js', 'index.js', 'client.js']) {
  fs.copyFileSync(path.join(src, f), path.join(lib, f))
}

// 自检：client 必须使用 __ModuleLoader__ 格式（允许前置注释块）
const client = fs.readFileSync(path.join(lib, 'client.js'), 'utf8')
const okFormat = /window\.__ModuleLoader__\.load\(\s*\{/.test(client)
if (!okFormat) {
  console.error('BUILD FAIL: lib/client.js 不是 __ModuleLoader__ 格式，DSH 将无法加载')
  process.exit(1)
}
if (/\bexport const\b|\bexport function\b/.test(client)) {
  console.error('BUILD FAIL: lib/client.js 仍含 ESM export 语法')
  process.exit(1)
}

for (const f of ['index.js', 'aliyun.js', 'usage.js', 'client.js']) {
  const p = path.join(lib, f)
  console.log(`  ${f}: ${fs.statSync(p).size} B`)
}
console.log('build ok (client format verified: __ModuleLoader__)')
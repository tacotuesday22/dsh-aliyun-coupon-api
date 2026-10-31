// 最终验收：直接加载 profile 中已安装的插件副本，模拟 DSH 客户端加载器。
import fs from 'node:fs'
import vm from 'node:vm'
import { join } from 'node:path'
import { homedir } from 'node:os'

const BASE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop', 'node_modules', 'dsh-aliyun-coupon-api')
let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

const pkg = JSON.parse(fs.readFileSync(BASE + '/package.json', 'utf8'))
console.log('已安装版本:', pkg.version)

// ---- 1. host 端能否 import ----
console.log('\n=== Host 端 (index.js) ===')
try {
  const host = await import('file:///' + BASE + '/lib/index.js')
  ok(typeof host.apply === 'function', 'host apply 可导入')
  ok(host.name === 'aliyun-coupon-api', 'host name 正确', host.name)
} catch (e) {
  ok(false, 'host 导入失败', e.message)
}

// ---- 2. client 端能否被 __ModuleLoader__ 加载 ----
console.log('\n=== Client 端 (client.js) ===')
const code = fs.readFileSync(BASE + '/lib/client.js', 'utf8')
const ReactStub = {
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useCallback: (f) => f, useEffect: () => {},
  createElement: (t, p, ...c) => ({ t, p, c }),
}
let loaded = null
const sandbox = {
  window: { __ModuleLoader__: { load: (s) => { loaded = s } } },
  document: { hidden: false, head: { appendChild() {} }, getElementById: () => null,
              createElement: () => ({ id: '', textContent: '' }) },
  fetch: async () => ({ json: async () => ({ ok: true, coupon: null, balance: null }) }),
  setInterval: () => 0, clearInterval: () => {}, console,
}
sandbox.globalThis = sandbox
sandbox.window.document = sandbox.document
vm.createContext(sandbox)

try {
  vm.runInContext(code, sandbox, { filename: 'client.js' })
  ok(true, 'client.js 执行无 "module is not defined"')
} catch (e) {
  ok(false, 'client.js 执行失败', e.message)
  process.exit(1)
}

ok(loaded !== null, '__ModuleLoader__.load 被调用')
const mod = loaded.factory((n) => { if (n === 'react') return ReactStub; throw new Error('unexpected: ' + n) })
ok(typeof mod.apply === 'function', 'factory 返回 apply')
ok(Array.isArray(mod.inject), 'factory 返回 inject', JSON.stringify(mod.inject))

let reg = null
mod.apply({
  effect: (f) => { const d = f(); if (typeof d === 'function') d() },
  slots: { register: (o, C) => { reg = { o, C }; return () => {} }, inject: (n, f) => f() },
})
ok(reg?.o?.name === 'sidebar.footer.action', '注册到 sidebar.footer.action')
ok(typeof reg?.C === 'function', '组件可注册')

// ---- 3. 其他插件是否还在 ----
console.log('\n=== 其他插件包 ===')
for (const n of ['dsh-cost-meter', 'dsh-plugin-marketplace']) {
  ok(fs.existsSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles','desktop','node_modules', n, 'package.json')), n + ' 存在')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
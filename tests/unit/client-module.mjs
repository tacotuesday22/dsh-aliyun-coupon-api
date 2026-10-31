// 验证 client.js 是 __ModuleLoader__ 格式，且能被 DSH 加载器正确执行。
import fs from 'node:fs'
import vm from 'node:vm'

const p = new URL('../../lib/client.js', import.meta.url)
const code = fs.readFileSync(p, 'utf8')

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

console.log('=== 格式检查 ===')
ok(/window\.__ModuleLoader__\.load\(\s*\{/.test(code), '使用 __ModuleLoader__.load 格式')
ok(!/\bexport const\b/.test(code), '不含 ESM export const')
ok(!/^module\.exports\s*=/m.test(code), '不以裸 module.exports 开头（这曾导致 web boot 崩溃）')

// ---- 模拟 DSH 客户端加载器 ----
const ReactStub = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
  createElement: (type, props, ...children) => ({ type, props, children }),
}

let loaded = null
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => { loaded = spec } } },
  document: {
    hidden: false,
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
  },
  fetch: async () => ({ json: async () => ({ ok: false, configured: false }) }),
  setInterval: () => 0,
  clearInterval: () => {},
  console,
}
sandbox.globalThis = sandbox
sandbox.window.document = sandbox.document

vm.createContext(sandbox)
try {
  vm.runInContext(code, sandbox, { filename: 'client.js' })
  ok(true, '脚本执行无异常（无 "module is not defined"）')
} catch (e) {
  ok(false, '脚本执行失败', e.message)
  process.exit(1)
}

console.log('\n=== 加载器契约 ===')
ok(loaded !== null, '__ModuleLoader__.load 被调用')
ok(loaded.id === 'dsh-aliyun-coupon-api', 'id 正确', loaded?.id)

let exported = null
try {
  exported = loaded.factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error('unexpected require: ' + name)
  })
  ok(true, 'factory 执行成功')
} catch (e) {
  ok(false, 'factory 执行失败', e.message)
  process.exit(1)
}

ok(exported && typeof exported === 'object', 'factory 返回对象')
ok(typeof exported.apply === 'function', 'exports.apply 是函数')
ok(Array.isArray(exported.inject) && exported.inject.includes('slots'), 'exports.inject 含 slots', JSON.stringify(exported.inject))

console.log('\n=== 插槽注册 ===')
const registered = []
const ctx = {
  effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
  slots: {
    register: (opts, Comp) => { registered.push({ opts, Comp }); return () => {} },
    inject: (name, fn) => { fn() },
  },
}
try {
  exported.apply(ctx)
  ok(true, 'apply 执行无异常')
} catch (e) {
  ok(false, 'apply 抛异常', e.message)
}

ok(registered.length === 2, '注册了 2 个插槽', String(registered.length))

const card = registered.find(r => r.opts.name === 'sidebar.footer.action')
const section = registered.find(r => r.opts.name === 'settings.section')

ok(!!card, '注册到 sidebar.footer.action（侧边栏卡片）')
ok(card?.opts?.id === 'aliyun-coupon-api', '卡片插槽 id 正确', card?.opts?.id)
ok(typeof card?.Comp === 'function', '卡片是组件函数')

ok(!!section, '注册到 settings.section（设置页配置区块）')
ok(section?.opts?.id === 'aliyun-coupon', '设置区块 id 正确', section?.opts?.id)
ok(typeof section?.opts?.label === 'string' && section.opts.label.length > 0,
  '设置区块有显示名称', section?.opts?.label)
ok(typeof section?.Comp === 'function', '设置区块是组件函数')

// 渲染一次，确认组件不崩
for (const [name, r] of [['卡片', card], ['设置区块', section]]) {
  try {
    const el = r.Comp({})
    ok(el !== undefined && el !== null, name + '首次渲染返回元素')
  } catch (e) {
    ok(false, name + '渲染抛异常', e.message)
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
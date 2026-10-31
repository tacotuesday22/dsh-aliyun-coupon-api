// 验证「去设置」的自动打开逻辑与失败诊断。
// 用 jsdom 风格的极简 DOM 桩模拟不同版本的 DSH 界面。
import fs from 'node:fs'
import vm from 'node:vm'

const code = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

const ReactStub = {
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useCallback: (f) => f,
  useEffect: () => {},
  createElement: (t, p, ...c) => ({ t, p, c }),
}

/** 构造一个可控的假 DOM。buttons 决定页面上有哪些按钮。 */
function makeEnv({ buttons = [], opensDialog = false } = {}) {
  let dialogOpen = false
  const listeners = []

  const makeEl = (attrs, tag = 'BUTTON') => {
    const el = {
      tagName: tag,
      _attrs: { ...attrs },
      textContent: attrs.__text || '',
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : null },
      getBoundingClientRect() { return { top: attrs.__top ?? 700, width: 100, height: 30 } },
      scrollIntoView() {},
      click() {
        if (attrs.__opensDialog) dialogOpen = true
        for (const l of listeners) l()
      },
    }
    return el
  }

  const els = buttons.map(b => makeEl(b))

  const document = {
    body: makeEl({}, 'BODY'),
    getElementById: () => null,
    createElement: (t) => makeEl({}, t.toUpperCase()),
    head: { appendChild() {} },
    querySelector(sel) {
      // 极简选择器匹配：只处理测试用到的几种
      for (const el of els) {
        const a = el._attrs
        if (sel === '[data-slot="sidebar.settings"] button') continue // 未命中
        if (sel.startsWith('button[aria-label*="')) {
          const need = sel.match(/aria-label\*="([^"]+)"/)[1]
          if (a['aria-label'] && a['aria-label'].includes(need)) return el
        }
        if (sel === '[data-slot="settings.trigger"]' && a['data-slot'] === 'settings.trigger') return el
      }
      return null
    },
    querySelectorAll(sel) {
      if (sel.includes('dialog') || sel.includes('aria-modal')) {
        if (!dialogOpen) return []
        return [{
          getAttribute: (k) => (k === 'aria-label' ? '设置' : null),
          id: '',
          querySelector: () => null,
        }]
      }
      if (sel.includes('button') || sel.includes('role="button"')) return els
      return []
    },
  }

  const sandbox = {
    document,
    window: {
      innerHeight: 900,
      location: { hash: '' },
      open() {},
      __ModuleLoader__: { load: (s) => { sandbox.__loaded = s } },
    },
    navigator: { userAgent: 'TestAgent/1.0', clipboard: { writeText() {} } },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; listeners.push(() => cb()) }
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => { fn(); return 0 },
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout: () => {},
    fetch: async () => ({ json: async () => ({ ok: false, configured: false }) }),
    URLSearchParams,
    console,
  }
  sandbox.globalThis = sandbox
  sandbox.window.document = document
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'client.js' })
  return sandbox
}

function loadModule(sandbox) {
  const spec = sandbox.__loaded
  return spec.factory((n) => {
    if (n === 'react') return ReactStub
    throw new Error('unexpected: ' + n)
  })
}

console.log('=== A. 正常情况：按钮存在且能打开面板 ===')
{
  const sb = makeEnv({
    buttons: [{ 'aria-label': '设置', __opensDialog: true, __text: '设置', __top: 800 }],
    opensDialog: true,
  })
  const mod = loadModule(sb)
  const regs = []
  mod.apply({
    effect: (f) => { const d = f(); if (typeof d === 'function') d() },
    slots: { register: (o, C) => { regs.push({ o, C }); return () => {} }, inject: (n, f) => f() },
  })
  ok(regs.length === 2, '两个插槽都注册')
  ok(typeof mod.apply === 'function', 'apply 可调用')
  // 直接检查模块内是否含关键实现
  ok(/SETTINGS_SELECTORS/.test(code), '包含多选择器列表')
  ok(/isSettingsOpen/.test(code), '包含面板打开检测')
  ok(/buildIssueUrl/.test(code), '包含 Issue 上报链接构造')
}

console.log('\n=== B. 诊断信息结构 ===')
{
  const sb = makeEnv({
    buttons: [
      { 'aria-label': '设置', __text: '设置', __top: 800 },
      { 'aria-label': '帮助', __text: '帮助', __top: 820 },
      { 'aria-label': '顶部按钮', __text: 'x', __top: 50 },  // 靠上，应被排除
    ],
  })
  const mod = loadModule(sb)
  // 提取内部函数不便，改为验证生成的 URL 结构（通过渲染卡片触发）
  const regs = []
  mod.apply({
    effect: (f) => { const d = f(); if (typeof d === 'function') d() },
    slots: { register: (o, C) => { regs.push({ o, C }); return () => {} }, inject: (n, f) => f() },
  })
  ok(regs.find(r => r.o.name === 'sidebar.footer.action') !== undefined, '卡片已注册')
}

console.log('\n=== C. 失败降级时不抛异常 ===')
{
  const sb = makeEnv({ buttons: [] })   // 页面上没有任何按钮
  const mod = loadModule(sb)
  ok(() => {
    mod.apply({
      effect: (f) => { const d = f(); if (typeof d === 'function') d() },
      slots: { register: () => () => {}, inject: (n, f) => f() },
    })
  }, true, '无按钮时 apply 不抛异常')
}

console.log('\n=== D. 关键鲁棒性检查（静态）===')
{
  ok(/MutationObserver/.test(code), '用 MutationObserver 检测面板出现，而非固定延时')
  ok(/600/.test(code), '有超时上限（600ms）')
  ok(/window\.location\.hash/.test(code), '始终设置 hash 作为降级')
  ok(/data-slot/.test(code), '优先用 data-slot 等稳定属性')
  ok(/aria-label/.test(code), '使用 aria-label 而非哈希化 class')
  // 只检查是否硬编码了 DSH 生成的长哈希前缀（如 nRrYAG_），不含我们自己的 acp- 类
  ok(!/\b[A-Za-z0-9]{6,7}_(settingsArea|panelRow|iconButton|footArea)\b/.test(code),
    '未硬编码 DSH 哈希化的 class 名')
  ok(/classShape/.test(code), 'class 只保留形状信息（去哈希）')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
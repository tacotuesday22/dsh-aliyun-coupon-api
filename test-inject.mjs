// 验证注入式路由注册：模拟 Cordis 的 ctx.inject(deps, cb) 语义。
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

const LIB = new URL('./lib/index.js', import.meta.url)
const mod = await import(LIB.href)

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

function makeCtx({ webServerInitiallyReady = true } = {}) {
  const routes = []
  const effects = []
  const services = {}

  if (webServerInitiallyReady) {
    services.webServer = { register: (r) => { routes.push(r); return () => {} } }
  }
  services.connection = { admit: () => ({ peer: { id: 'x' } }) }

  const makeScope = () => ({
    get: (n) => services[n] ?? null,
    effect: (fn, label) => { const d = fn(); effects.push({ d, label }); if (typeof d === 'function') d() },
    // 嵌套 inject 也要支持
    inject: (deps, cb) => {
      const ready = deps.every(d => services[d])
      if (!ready) return false
      cb(makeScope())
      return true
    },
  })

  const ctx = {
    get: (n) => services[n] ?? null,
    effect: (fn, label) => { const d = fn(); effects.push({ d, label }); if (typeof d === 'function') d() },
    inject: (deps, cb) => {
      const ready = deps.every(d => services[d])
      if (!ready) { ctx.__pending = { deps, cb }; return false }
      // Cordis 语义：cb 收到一个已就绪的 scope
      cb(makeScope())
      return true
    },
  }
  return { ctx, routes, services, makeScope }
}

console.log('=== A. webServer 已就绪 → 应立即注册路由 ===')
{
  const { ctx, routes } = makeCtx({ webServerInitiallyReady: true })
  mod.apply(ctx)
  ok(routes.length === 1, '注册了 1 条路由', String(routes.length))
  ok(routes[0]?.path === '/api/aliyun-coupon', '路由前缀正确', routes[0]?.path)
  ok(routes[0]?.kind === 'prefix', '使用 prefix 匹配', routes[0]?.kind)
}

console.log('\n=== B. webServer 尚未就绪 → 应等到依赖出现再注册（本次 bug 的核心）===')
{
  const { ctx, routes, services } = makeCtx({ webServerInitiallyReady: false })
  mod.apply(ctx)
  ok(routes.length === 0, 'apply 时不注册（因为依赖未就绪）')
  ok(ctx.__pending !== undefined, '记录了待注入的依赖', JSON.stringify(ctx.__pending?.deps))
  ok(ctx.__pending?.deps?.includes('webServer'), '待注入的依赖含 webServer')

  // 模拟 Cordis 在 webServer 就绪后回调
  services.webServer = { register: (r) => { routes.push(r); return () => {} } }
  ctx.__pending.cb(ctx.__pending.makeScope ? ctx.__pending.makeScope() : {
    get: (n) => services[n] ?? null,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
  })
  ok(routes.length === 1, '依赖就绪后成功注册路由', String(routes.length))
}

console.log('\n=== C. 不应再依赖 ctx.get 的同步返回 ===')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(fileURLToPath(LIB), 'utf8')
  ok(/ctx\.inject\(\s*\[\s*'webServer'/.test(src), '代码使用 ctx.inject([\'webServer\'], ...)')
  ok(!/candidates\s*=\s*\[\s*'webServer'/.test(src), '已移除旧的候选名轮询写法')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
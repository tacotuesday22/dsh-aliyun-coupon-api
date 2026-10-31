// 端到端验证：加载 lib/index.js，用假 ctx 跑一遍路由。
import { EventEmitter } from 'node:events'

const mod = await import('./lib/index.js')
console.log('exports:', Object.keys(mod))
console.log('name:', mod.name)

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

const routes = []
const fake = {
  get: (n) => ({
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    connection: { admit: () => ({ peer: { id: 'test' } }) },
    credentials: { resolve: async () => null },
  })[n] ?? null,
  effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
}

mod.apply(fake)
ok(routes.length === 1, '注册了 1 条路由', String(routes.length))
ok(routes[0]?.path === '/api/aliyun-coupon', '路由前缀正确', routes[0]?.path)

const callRoute = async (path, method = 'GET', admit = true) => {
  const req = Object.assign(new EventEmitter(), {
    url: path, method, headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
  })
  let body = ''
  const res = {
    statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; return this },
    write(c) { body += c; return true }, end(c) { if (c) body += c; return this },
  }
  if (!admit) fake.get = () => null
  await routes[0].handler(req, res)
  let json = null
  try { json = JSON.parse(body) } catch { /* ignore */ }
  return { status: res.statusCode, json }
}

console.log('\n=== 路由行为（未配置凭据）===')
const diag = await callRoute('/api/aliyun-coupon/diag')
ok(diag.status === 200, 'diag 返回 200')
ok(!JSON.stringify(diag.json).match(/ACCESS_KEY_SECRET|SECRET=/), 'diag 不含任何密钥')

// 下面的"未配置"断言需要一个确实没有凭据的环境：
// 指向一个不存在的 DSH_HOME，并清掉同名环境变量。
const savedHome = process.env.DSH_HOME
const savedAk = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID
const savedSk = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
process.env.DSH_HOME = 'C:/nonexistent-dsh-home-for-test'
delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID
delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET

const bal = await callRoute('/api/aliyun-coupon/balance')
ok(bal.status === 200, 'balance 返回 200')
ok(bal.json?.configured === false, '确实无凭据时 configured=false', String(bal.json?.configured))
ok(typeof bal.json?.error === 'string', '给出可读错误提示')

// 还原环境
if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome
if (savedAk !== undefined) process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = savedAk
if (savedSk !== undefined) process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = savedSk

console.log('\n=== 鉴权 ===')
const noAuth = await callRoute('/api/aliyun-coupon/balance', 'GET', false)
ok(noAuth.status === 503, '缺少 connection 服务时 fail-closed（503）', String(noAuth.status))

console.log('\n=== 未知路径 ===')
fake.get = (n) => ({
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  connection: { admit: () => ({ peer: { id: 'test' } }) },
  credentials: { resolve: async () => null },
})[n] ?? null
const nf = await callRoute('/api/aliyun-coupon/nope')
ok(nf.status === 404, '未知路径返回 404', String(nf.status))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
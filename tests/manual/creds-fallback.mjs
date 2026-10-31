// 验证 host 端凭据读取的三级回落，用真实凭据文件。
import { EventEmitter } from 'node:events'

const mod = await import('../../lib/index.js')

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

function buildCtx(credentialsImpl) {
  const routes = []
  const services = {
    credentials: credentialsImpl,
    connection: { admit: () => ({ peer: { id: 'x' } }) },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
  }
  const makeScope = () => ({
    get: (n) => services[n] ?? null,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
    inject: (deps, cb) => { if (deps.every(d => services[d])) cb(makeScope()) },
  })
  const ctx = {
    get: (n) => services[n] ?? null,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
    inject: (deps, cb) => { if (deps.every(d => services[d])) cb(makeScope()) },
  }
  return { ctx, routes }
}

async function callDiag(routes) {
  const req = Object.assign(new EventEmitter(), {
    url: '/api/aliyun-coupon/diag', method: 'GET',
    headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
  })
  let body = ''
  const res = { statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; return this },
                write(c) { body += c; return true }, end(c) { if (c) body += c; return this } }
  await routes[0].handler(req, res)
  return JSON.parse(body)
}

console.log('=== A. credentials 服务不可用 → 应回落到凭据文件 ===')
{
  const { ctx, routes } = buildCtx(null)
  mod.apply(ctx)
  const d = await callDiag(routes)
  console.log('  diag:', JSON.stringify(d))
  ok(d.hasCredentials === true, '从 .credentials.yaml 成功读到凭据', String(d.hasCredentials))
}

console.log('\n=== B. credentials 服务抛错 → 仍应回落成功 ===')
{
  const broken = { resolve: async () => { throw new Error('service broken') } }
  const { ctx, routes } = buildCtx(broken)
  mod.apply(ctx)
  const d = await callDiag(routes)
  ok(d.hasCredentials === true, '服务异常时凭据仍可读', String(d.hasCredentials))
}

console.log('\n=== C. credentials 服务返回 { value } → 优先使用服务 ===')
{
  const good = { resolve: async (arg) => {
    const k = typeof arg === 'string' ? arg : arg?.name
    if (k === 'ALIBABA_CLOUD_ACCESS_KEY_ID') return { value: 'SERVICE_AK', source: 'file' }
    if (k === 'ALIBABA_CLOUD_ACCESS_KEY_SECRET') return { value: 'SERVICE_SK', source: 'file' }
    return undefined
  } }
  const { ctx, routes } = buildCtx(good)
  mod.apply(ctx)
  const d = await callDiag(routes)
  ok(d.hasCredentials === true, '服务可用时读取成功')
}

console.log('\n=== D. diag 不含密钥 ===')
{
  const { ctx, routes } = buildCtx(null)
  mod.apply(ctx)
  const d = await callDiag(routes)
  const text = JSON.stringify(d)
  ok(!/LTAI/.test(text), '不含 AccessKey ID 明文')
  ok(!/SECRET=|secret.*[:=].*[A-Za-z0-9]{20}/i.test(text), '不含 Secret')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
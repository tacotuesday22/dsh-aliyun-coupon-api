// 验证凭据配置接口：读取、保存、校验、测试连接、清除。
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 隔离环境：用临时 DSH_HOME，避免读到本机真实凭据
const HOME = mkdtempSync(join(tmpdir(), 'acp-test-'))
process.env.DSH_HOME = HOME
const CRED_FILE = join(HOME, '.credentials.yaml')
writeFileSync(CRED_FILE, 'version: 1\nrefs:\n  OTHER_KEY: something\n')

const mod = await import(new URL('../../lib/index.js', import.meta.url).href)

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

// 假的 credentials 服务（可读写）
function makeStore(initial = {}) {
  const store = { ...initial }
  return {
    store,
    api: {
      resolve: async (k) => {
        const key = typeof k === 'string' ? k : (k?.name || k?.key)
        return key in store ? { value: store[key], source: 'store' } : undefined
      },
      describe: async (k) => {
        const key = typeof k === 'string' ? k : (k?.name || k?.key)
        return { configured: key in store, writable: true }
      },
      set: async (k, v) => { const key = typeof k === 'string' ? k : (k?.name || k?.key); store[key] = v },
      unset: async (k) => { const key = typeof k === 'string' ? k : (k?.name || k?.key); delete store[key] },
    },
  }
}

function makeCtx(credApi) {
  const routes = []
  const services = {
    credentials: credApi,
    connection: { admit: () => ({ peer: { id: 'x' } }) },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
  }
  const makeScope = () => ({
    get: (n) => services[n] ?? null,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
    inject: (deps, cb) => { if (deps.every(d => services[d])) cb(makeScope()) },
  })
  return {
    ctx: {
      get: (n) => services[n] ?? null,
      effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
      inject: (deps, cb) => { if (deps.every(d => services[d])) cb(makeScope()) },
    },
    routes,
  }
}

async function call(routes, path, method = 'GET', body = null) {
  const req = Object.assign(new EventEmitter(), {
    url: path, method, headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
  })
  let resBody = ''
  const res = { statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; return this },
                write(c) { resBody += c; return true }, end(c) { if (c) resBody += c; return this } }
  const p = routes[0].handler(req, res)
  if (body !== null) {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  } else {
    req.emit('end')
  }
  await p
  let json = null
  try { json = JSON.parse(resBody) } catch { /* ignore */ }
  return { status: res.statusCode, json }
}

// 屏蔽真实网络：阿里云请求返回可控结果
const realFetch = globalThis.fetch
let aliMode = 'ok'
globalThis.fetch = async (url, init) => {
  if (String(url).includes('business.aliyuncs.com')) {
    if (aliMode === 'unauthorized') {
      return { ok: false, status: 403, headers: new Map(), text: async () => '' }
    }
    const body = { TotalCount: 1, Data: [{ CouponNo: 'A', Status: 'AVAILABLE', Amount: '300', RemainAmount: '250.00', EndTime: '2027-10-20T15:00Z', Currency: 'CNY' }] }
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) }
  }
  return realFetch(url, init)
}

console.log('=== A. 未配置时的 GET /config ===')
{
  const { api } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const r = await call(routes, '/api/aliyun-coupon/config')
  ok(r.status === 200, '返回 200')
  ok(r.json.configured === false, 'configured=false')
  ok(r.json.akTail === '', '无 AK 末位')
  ok(!JSON.stringify(r.json).includes('LTAI'), '不泄露任何 AK')
}

console.log('\n=== B. 格式校验：拦住模型 API Key ===')
{
  const { api } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const r = await call(routes, '/api/aliyun-coupon/config', 'POST', { accessKeyId: 'sk-abcdefghijklmnop', accessKeySecret: 'x'.repeat(32) })
  ok(r.status === 400, '返回 400', String(r.status))
  ok(/LTAI/.test(r.json.error), '提示应以 LTAI 开头')
  ok(/模型 API Key/.test(r.json.error), '明确指出像是模型 Key', r.json.error)
}

console.log('\n=== C. 空值校验 ===')
{
  const { api } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const r1 = await call(routes, '/api/aliyun-coupon/config', 'POST', { accessKeyId: '', accessKeySecret: '' })
  ok(r1.status === 400, '空值被拒', String(r1.status))
  const r2 = await call(routes, '/api/aliyun-coupon/config', 'POST', { accessKeyId: 'LTAIFAKEfakeFAKEfake01', accessKeySecret: 'short' })
  ok(r2.status === 400, 'Secret 过短被拒', String(r2.status))
}

console.log('\n=== D. 验证失败时不写入 ===')
{
  aliMode = 'unauthorized'
  const { api, store } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const r = await call(routes, '/api/aliyun-coupon/config', 'POST', { accessKeyId: 'LTAIFAKEfakeFAKEfake01', accessKeySecret: 'a'.repeat(30) })
  ok(r.status === 400, '返回 400', String(r.status))
  ok(r.json.stage === 'verify', '标记为验证阶段失败', r.json.stage)
  ok(!store.ALIBABA_CLOUD_ACCESS_KEY_ID, '未写入凭据库', JSON.stringify(Object.keys(store)))
  aliMode = 'ok'
}

console.log('\n=== E. 验证通过才写入 ===')
{
  const { api, store } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const r = await call(routes, '/api/aliyun-coupon/config', 'POST', { accessKeyId: 'LTAIFAKEfakeFAKEfake01', accessKeySecret: 'b'.repeat(30) })
  ok(r.status === 200, '返回 200', String(r.status))
  ok(r.json.ok === true, 'ok=true')
  ok(r.json.akTail === 'ke01', '返回 AK 末四位', r.json.akTail)
  ok(store.ALIBABA_CLOUD_ACCESS_KEY_ID === 'LTAIFAKEfakeFAKEfake01', 'AK 已写入')
  ok(store.ALIBABA_CLOUD_ACCESS_KEY_SECRET === 'b'.repeat(30), 'SK 已写入')
  ok(!JSON.stringify(r.json).includes('b'.repeat(30)), '响应不包含 Secret')
}

console.log('\n=== F. 已配置后的状态与测试连接 ===')
{
  writeFileSync(CRED_FILE, 'version: 1\nrefs:\n  OTHER_KEY: something\n')
  const { api } = makeStore({ ALIBABA_CLOUD_ACCESS_KEY_ID: 'LTAIFAKEfakeFAKEfake02', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c'.repeat(30) })
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const cfg = await call(routes, '/api/aliyun-coupon/config')
  ok(cfg.json.configured === true, 'configured=true')
  ok(cfg.json.akTail === 'ke02', 'AK 末四位正确', cfg.json.akTail)
  ok(!JSON.stringify(cfg.json).includes('LTAI'), '状态响应不含完整 AK')

  const t = await call(routes, '/api/aliyun-coupon/test')
  ok(t.json.ok === true, '测试连接成功', JSON.stringify(t.json))
  ok(typeof t.json.remain === 'number', '返回余额数值')
}

console.log('\n=== G. 清除配置（同时清理凭据文件）===')
{
  // 同时写进存储和文件，模拟真实使用中出现过的状态
  writeFileSync(CRED_FILE, [
    'version: 1',
    'refs:',
    '  OTHER_KEY: something',
    '  ALIBABA_CLOUD_ACCESS_KEY_ID: LTAIFAKEfakeFAKEfake03',
    '  ALIBABA_CLOUD_ACCESS_KEY_SECRET: ' + 'f'.repeat(30),
    '',
  ].join('\n'))

  const { api, store } = makeStore({
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'LTAIFAKEfakeFAKEfake04',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c'.repeat(30),
  })
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)

  const before = await call(routes, '/api/aliyun-coupon/config')
  ok(before.json.configured === true, '清除前已配置')
  ok(before.json.source === 'store', '来源标记为 store', before.json.source)

  const r = await call(routes, '/api/aliyun-coupon/config', 'DELETE')
  ok(r.json.ok === true, '清除成功')
  ok(!store.ALIBABA_CLOUD_ACCESS_KEY_ID && !store.ALIBABA_CLOUD_ACCESS_KEY_SECRET, '凭据已从存储移除')

  const fileText = readFileSync(CRED_FILE, 'utf8')
  ok(!/ALIBABA_CLOUD_ACCESS_KEY_ID/.test(fileText), '凭据文件中的 AK 行已移除')
  ok(!/ALIBABA_CLOUD_ACCESS_KEY_SECRET/.test(fileText), '凭据文件中的 SK 行已移除')
  ok(/OTHER_KEY/.test(fileText), '凭据文件中其他键原样保留')

  const cfg = await call(routes, '/api/aliyun-coupon/config')
  ok(cfg.json.configured === false, '清除后 configured=false', String(cfg.json.configured))
  ok(cfg.json.source === 'none', '来源变为 none', cfg.json.source)
}

console.log('\n=== H. 凭据来自文件时能正确识别来源 ===')
{
  writeFileSync(CRED_FILE, [
    'version: 1',
    'refs:',
    '  ALIBABA_CLOUD_ACCESS_KEY_ID: LTAIFAKEfakeFAKEfake05',
    '  ALIBABA_CLOUD_ACCESS_KEY_SECRET: ' + 'g'.repeat(30),
    '',
  ].join('\n'))
  const { api } = makeStore({})
  const { ctx, routes } = makeCtx(api)
  mod.apply(ctx)
  const cfg = await call(routes, '/api/aliyun-coupon/config')
  ok(cfg.json.configured === true, '仅文件时仍视为已配置')
  ok(cfg.json.source === 'file', '来源标记为 file', cfg.json.source)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
globalThis.fetch = realFetch
process.exit(fail ? 1 : 0)
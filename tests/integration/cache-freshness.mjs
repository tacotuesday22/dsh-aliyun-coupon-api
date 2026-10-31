// 验证：阿里云数据被缓存时，今日消耗仍必须是实时的。
import fs from 'node:fs'
import { EventEmitter } from 'node:events'

const mod = await import(new URL('../../lib/index.js', import.meta.url).href)

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

// 提供一个假的阿里云查询：第一次返回数据，之后计数
let aliCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('business.aliyuncs.com')) {
    aliCalls++
    const body = aliCalls === 1
      ? { TotalCount: 1, Data: [{ CouponNo: 'A', Status: 'AVAILABLE', Amount: '300', RemainAmount: '258.70', EndTime: '2027-10-20T15:00Z', Currency: 'CNY' }] }
      : { TotalCount: 1, Data: [{ CouponNo: 'A', Status: 'AVAILABLE', Amount: '300', RemainAmount: '258.70', EndTime: '2027-10-20T15:00Z', Currency: 'CNY' }] }
    return { ok: true, status: 200, headers: new Map([['content-length', '999']]), text: async () => JSON.stringify(body) }
  }
  return realFetch(url, init)
}

function makeCtx() {
  const routes = []
  const services = {
    credentials: { resolve: async (k) => {
      const key = typeof k === 'string' ? k : (k?.name || k?.key)
      if (key === 'ALIBABA_CLOUD_ACCESS_KEY_ID') return { value: 'AK_TEST' }
      if (key === 'ALIBABA_CLOUD_ACCESS_KEY_SECRET') return { value: 'SK_TEST' }
      return undefined
    } },
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

async function call(routes, path) {
  const req = Object.assign(new EventEmitter(), {
    url: path, method: 'GET', headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
  })
  let body = ''
  const res = { statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; return this },
                write(c) { body += c; return true }, end(c) { if (c) body += c; return this } }
  await routes[0].handler(req, res)
  return JSON.parse(body)
}

console.log('=== 缓存命中时，usage 必须是实时值 ===')
const { ctx, routes } = makeCtx()
mod.apply(ctx)

const first = await call(routes, '/api/aliyun-coupon/balance')
ok(first.usage !== undefined, '第一次返回含 usage')
ok(first.cached !== true, '第一次是真实查询', String(first.cached))
const t1 = first.usage.tokens

// 直接改写账本，模拟"消耗增加了"
const home = process.env.DSH_HOME || (await import('node:os')).homedir() + '/.dsh'
const ledgerPath = `${home}/storages/cost-meter/ledger.json`.replace(/\\/g, '/')
const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
const p = (n) => String(n).padStart(2, '0')
const d = new Date()
const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
const backup = JSON.parse(JSON.stringify(raw.days[key] || {}))

if (!raw.days[key]) raw.days[key] = { date: key }
const before = raw.days[key].input || 0
raw.days[key].input = before + 5_000_000          // 人为增加 5M token
fs.writeFileSync(ledgerPath, JSON.stringify(raw))

const second = await call(routes, '/api/aliyun-coupon/balance')
ok(second.cached === true, '第二次命中缓存（未重复调用阿里云）', String(second.cached))
// 第一次会调用两个接口（DescribeCoupon + QueryAccountBalance），所以计数应为 2
ok(aliCalls === 2, '缓存命中后未再调用阿里云（总调用数仍为首次的 2 次）', String(aliCalls))
ok(second.usage.tokens === t1 + 5_000_000,
  '缓存命中时 usage 仍然反映最新的账本变化',
  `${second.usage.tokens} vs 期望 ${t1 + 5_000_000}`)

// 还原账本
if (Object.keys(backup).length) raw.days[key] = backup
else delete raw.days[key]
fs.writeFileSync(ledgerPath, JSON.stringify(raw))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
globalThis.fetch = realFetch
process.exit(fail ? 1 : 0)
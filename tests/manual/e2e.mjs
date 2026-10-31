// 端到端验证：在真实凭据环境下调用 /balance，确认能拿到券与余额。
import { EventEmitter } from 'node:events'

const mod = await import('../../lib/index.js')

const routes = []
const ctx = {
  get: (n) => {
    if (n === 'credentials') return null          // 模拟服务不可用，走文件兜底
    if (n === 'connection') return { admit: () => ({ peer: { id: 'x' } }) }
    if (n === 'webServer') return { register: (r) => { routes.push(r); return () => {} } }
    return null
  },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') d() },
}
mod.apply(ctx)

const req = Object.assign(new EventEmitter(), {
  url: '/api/aliyun-coupon/balance', method: 'GET',
  headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
})
let body = ''
const res = { statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; return this },
              write(c) { body += c; return true }, end(c) { if (c) body += c; return this } }
await routes[0].handler(req, res)

const d = JSON.parse(body)
console.log('HTTP', res.statusCode)
console.log('ok           :', d.ok)
console.log('configured   :', d.configured)
if (d.usage?.ok) console.log('今日消耗     :', (d.usage.tokens / 1e6).toFixed(1) + 'M tokens, ¥' + d.usage.cost.toFixed(2))
if (d.coupon) console.log('代金券       : 剩余 ¥' + d.coupon.total.remain.toFixed(2) + ' / 面值 ¥' + d.coupon.total.amount + ' / ' + d.coupon.total.count + ' 张')
if (d.balance) console.log('账户余额     : ¥' + d.balance.available.toFixed(2))
if (d.errors) console.log('errors       :', d.errors.join('; '))
if (d.error) console.log('error        :', d.error)

const good = d.ok === true && d.configured === true
console.log('\n' + (good ? '✓ 端到端通过' : '✗ 端到端失败'))
process.exit(good ? 0 : 1)
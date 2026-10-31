// 用假的 fetch 验证签名与归一化逻辑，不需要真实阿里云凭据。
import { signRequest, normalizeCoupons, normalizeBalance } from './src/aliyun.js'
import { createHash, createHmac } from 'node:crypto'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')) }
}

console.log('=== 1. 签名结构 ===')
const req = signRequest('TEST_AK_ID', 'TEST_AK_SECRET', 'DescribeCoupon', '{"a":1}', '', {
  now: new Date('2026-10-30T12:00:00Z'), nonce: 'fixed-nonce',
})
ok(req.method === 'POST', 'method 是 POST')
ok(req.redirect === 'manual', 'redirect=manual（不跟随重定向，防凭据外泄）')
ok(req.headers['x-acs-action'] === 'DescribeCoupon', 'action 正确')
ok(req.headers['x-acs-version'] === '2023-09-30', 'version 正确')
ok(req.headers['x-acs-date'] === '2026-10-30T12:00:00Z', '日期格式无毫秒')
ok(/^ACS3-HMAC-SHA256 Credential=TEST_AK_ID,SignedHeaders=/.test(req.headers.authorization), 'Authorization 前缀正确')
ok(req.headers.authorization.includes('Signature='), '含签名')
ok(!JSON.stringify(req).includes('TEST_AK_SECRET'), '密钥本身不出现在请求中')

// 独立复算签名，确认算法自洽
const sign = req.headers.authorization.match(/Signature=([0-9a-f]+)/)[1]
const hs = v => createHash('sha256').update(v).digest('hex')
const hdrs = { ...req.headers }
delete hdrs.authorization; delete hdrs.accept
const keys = Object.keys(hdrs).sort()
const canonHeaders = keys.map(k => `${k}:${hdrs[k].trim()}\n`).join('')
const canonical = ['POST', '/', '', canonHeaders, keys.join(';'), hs(req.body)].join('\n')
const expect = createHmac('sha256', 'TEST_AK_SECRET').update(`ACS3-HMAC-SHA256\n${hs(canonical)}`).digest('hex')
ok(sign === expect, '签名可独立复算一致')

console.log('\n=== 2. 响应归一化 ===')
const now = Date.parse('2026-10-30T00:00:00Z')
const payload = {
  Data: [
    { CouponNo: 'C1', Amount: '300.00', RemainAmount: '128.50', Status: 'Available', EndTime: '2026-11-05T00:00:00Z', CouponTypeName: '满减券', Currency: 'CNY' },
    { CouponNo: 'C2', Amount: '50.00', RemainAmount: '50.00', Status: 'Available', EndTime: '2026-11-01T00:00:00Z', Currency: 'CNY' },
    { CouponNo: 'C3', Amount: '100.00', RemainAmount: '0.00', Status: 'Expired', EndTime: '2026-01-01T00:00:00Z', Currency: 'CNY' },
  ],
}
const r = normalizeCoupons(payload, { now })
ok(r.total.remain === 178.5, '可用余额合计 = 128.50+50.00', String(r.total.remain))
ok(r.total.amount === 350, '可用面值合计 = 300+50（排除已过期）', String(r.total.amount))
ok(r.total.count === 2, '可用张数 = 2', String(r.total.count))
ok(Math.round(r.total.percent) === 49, '已用比例约 49%', String(r.total.percent))
ok(r.upcoming && r.upcoming.endMs === Date.parse('2026-11-01T00:00:00Z'), '最近到期取最早的一张')

console.log('\n=== 3. 边界情况 ===')
ok(normalizeCoupons({ Code: 'Forbidden.NoPermission', Message: 'no perm' })?.error === 'Forbidden.NoPermission', '错误响应被识别')
ok(normalizeCoupons({ Data: [] }).total.remain === 0, '空列表 → 0 而非崩溃')
const bad = normalizeCoupons({ Data: [{ Amount: 'abc', RemainAmount: 'xyz' }] })
ok(bad.coupons.length === 0, '金额不可解析的券被跳过（不当作 0）')
const mixed = normalizeCoupons({ Data: [{ Amount: '10', RemainAmount: '10', Status: 'Frozen', EndTime: '2027-01-01T00:00:00Z' }] }, { now })
ok(mixed.total.count === 0, '冻结/无效状态不计入可用')

console.log('\n=== 4. 账户余额归一化 ===')
const balPayload = {
  Code: '200', Message: 'success', Success: true,
  Data: { AvailableAmount: '10000.00', CreditAmount: '0.00', MybankCreditAmount: '0.00', Currency: 'CNY', AvailableCashAmount: '88.20', QuotaLimit: '10000.00\n' },
}
const b = normalizeBalance(balPayload)
ok(b.available === 10000, 'AvailableAmount 解析', String(b?.available))
ok(b.cash === 88.2, 'AvailableCashAmount 解析', String(b?.cash))
ok(b.currency === 'CNY', '币种解析')
ok(!b.error, '无错误')

const bErr = normalizeBalance({ Code: 'NoPermission', Message: 'You are not authorized', Success: false })
ok(bErr?.error === 'NoPermission', '权限错误被识别', bErr?.error)

const bBad = normalizeBalance({ Code: '200', Success: true, Data: { Currency: 'CNY' } })
ok(bBad === null, '缺金额字段时返回 null（不当作 0）')

console.log('\n=== 5. 两个接口的版本号不同 ===')
const rc = signRequest('AK', 'SK', 'DescribeCoupon', '{}', '', { version: '2023-09-30' })
const rb = signRequest('AK', 'SK', 'QueryAccountBalance', '{}', '', { version: '2017-12-14' })
ok(rc.headers['x-acs-version'] === '2023-09-30', 'DescribeCoupon 用 2023-09-30')
ok(rb.headers['x-acs-version'] === '2017-12-14', 'QueryAccountBalance 用 2017-12-14')
ok(rc.headers['x-acs-action'] !== rb.headers['x-acs-action'], 'action 不同')
ok(rb.headers.authorization.startsWith('ACS3-HMAC-SHA256 Credential=AK'), '余额请求同样用 ACS3 签名')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
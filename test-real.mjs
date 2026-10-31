// 用真实响应做回归测试：验证归一化对实际数据的处理，以及客户端格式化。
import fs from 'node:fs'
import { normalizeCoupons, normalizeBalance } from './src/aliyun.js'

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

// 真实的阿里云响应（取自实际调用）
const realCoupon = {
  TotalCount: 1, PageSize: 100, CurrentPage: 1,
  Data: [{
    CouponNo: '922868720315', Status: 'AVAILABLE', Amount: '300',
    RemainAmount: '282.9609674126', CouponTypeName: '抵用券',
    Remark: '阿里云云工开物学生专属代金券',
    StartTime: '2026-10-20T15:00Z', EndTime: '2027-10-20T15:00Z',
    Currency: 'CNY', ItemNames: ['通用（不适用商品名单除外）'], UniversalType: 'UNIVERSAL',
  }],
}

console.log('=== 真实券数据归一化 ===')
const r = normalizeCoupons(realCoupon)
ok(r.total.count === 1, '识别到 1 张券', String(r.total.count))
ok(Math.abs(r.total.amount - 300) < 0.001, '面值 300', String(r.total.amount))
ok(Math.abs(r.total.remain - 282.9609674126) < 0.001, '剩余 282.9609...', String(r.total.remain))
ok(Math.abs(r.total.percent - 5.679) < 0.01, '已用约 5.68%', String(r.total.percent))
ok(r.coupons[0].usable === true, 'AVAILABLE 状态被识别为可用')
ok(r.upcoming && r.upcoming.endTime === '2027-10-20T15:00Z', '最近到期时间正确')
ok(r.coupons[0].remark.includes('云工开物'), '备注识别正确')

console.log('\n=== 金额格式化 ===')
const fmtMoney = (n) => (typeof n !== 'number' || !Number.isFinite(n)) ? '—' : '¥' + n.toFixed(2)
ok(fmtMoney(282.9609674126) === '¥282.96', '282.9609... → ¥282.96', fmtMoney(282.9609674126))
ok(fmtMoney(300) === '¥300.00', '300 → ¥300.00', fmtMoney(300))
ok(fmtMoney(0) === '¥0.00', '0 → ¥0.00', fmtMoney(0))
ok(fmtMoney(null) === '—', 'null → —', fmtMoney(null))

console.log('\n=== 真实余额数据 ===')
const realBal = { Code: '200', Message: 'success', Success: true,
  Data: { AvailableAmount: '0.00', CreditAmount: '0.00', MybankCreditAmount: '0.00',
          Currency: 'CNY', AvailableCashAmount: '0.00', QuotaLimit: '0.00' } }
const b = normalizeBalance(realBal)
ok(b.available === 0, '可用额度 0', String(b.available))
ok(b.cash === 0, '可用现金 0', String(b.cash))
ok(b.currency === 'CNY', '币种 CNY')

console.log('\n=== 已过期券不计入 ===')
const expired = { Data: [{ CouponNo: 'X', Status: 'AVAILABLE', Amount: '100', RemainAmount: '100',
  EndTime: '2020-01-01T00:00Z', Currency: 'CNY' }] }
const e = normalizeCoupons(expired, { now: Date.parse('2026-10-30T00:00:00Z') })
ok(e.total.count === 0, '过期券不计入可用', String(e.total.count))
ok(e.total.remain === 0, '过期券余额不计入', String(e.total.remain))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
// 验证今日消耗读取：真实账本 + 各种边界情况。
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readTodayUsage } from './src/usage.js'

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

console.log('=== 1. 真实账本 ===')
const real = readTodayUsage()
console.log('  结果:', JSON.stringify(real))
if (real.ok) {
  ok(typeof real.tokens === 'number' && real.tokens >= 0, 'tokens 是有效数字')
  ok(typeof real.cost === 'number', 'cost 是有效数字')
  ok(real.cost >= 0, 'cost 非负')
  console.log(`  今日: ${(real.tokens / 1e6).toFixed(1)}M tokens, ¥${real.cost.toFixed(4)}, ${real.calls} 次调用`)
} else {
  console.log('  账本不可用，跳过正例断言（下面是边界测试）')
}

console.log('\n=== 2. 与账本原始值交叉核对 ===')
try {
  const raw = JSON.parse(fs.readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const day = raw.days[key]
  if (day && real.ok) {
    const expectTokens = (day.input || 0) + (day.output || 0) + (day.cacheRead || 0) + (day.cacheWrite || 0) + (day.reasoning || 0)
    ok(real.tokens === expectTokens, 'token 总量与账本各桶之和一致', `${real.tokens} vs ${expectTokens}`)
    const cur = raw.config?.currency || 'CNY'
    const expectCost = cur === 'CNY' ? day.costCny : cur === 'EUR' ? day.costEur : day.cost
    ok(Math.abs(real.cost - (expectCost || 0)) < 1e-9, '费用按配置币种取值正确', `${real.cost} vs ${expectCost}`)
    ok(real.calls === (day.calls || 0), '调用次数一致', `${real.calls} vs ${day.calls}`)
    ok(real.currency === cur, '币种一致', `${real.currency} vs ${cur}`)
  }
} catch (e) {
  console.log('  交叉核对跳过:', e.message)
}

console.log('\n=== 3. 边界：账本不存在 ===')
const saved = process.env.DSH_HOME
process.env.DSH_HOME = 'C:/nonexistent-dsh-home-for-test'
const missing = readTodayUsage()
ok(missing.ok === false, '不存在时 ok=false')
ok(missing.missing === true, '标记 missing=true（调用方据此隐藏该行）')
ok(!missing.tokens, '不返回假的 0 值')
process.env.DSH_HOME = saved

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
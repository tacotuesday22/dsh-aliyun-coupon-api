// 端到端真实调用测试。
// 从 DSH 凭据文件读取 AK/SK，实际请求阿里云两个接口。
// 输出中绝不包含任何密钥内容。
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { queryCoupons, queryBalance } from '../../src/aliyun.js'

const CRED = process.env.DSH_CREDENTIALS_FILE || join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')

function readRefs(text) {
  // 极简 YAML 解析：只取 refs: 段的顶层键值
  const lines = text.split(/\r?\n/)
  const refs = {}
  let inRefs = false
  for (const line of lines) {
    if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
    if (inRefs) {
      if (/^\S/.test(line)) break           // 离开 refs 段
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
      if (m) refs[m[1]] = m[2].trim()
    }
  }
  return refs
}

const refs = readRefs(fs.readFileSync(CRED, 'utf8'))
const accessKeyId = refs.ALIBABA_CLOUD_ACCESS_KEY_ID || ''
const accessKeySecret = refs.ALIBABA_CLOUD_ACCESS_KEY_SECRET || ''

console.log('=== 凭据读取 ===')
console.log('AccessKey ID 已读取 :', accessKeyId ? 'yes (len=' + accessKeyId.length + ', prefix=' + accessKeyId.slice(0, 4) + ')' : 'NO')
console.log('AccessKey Secret 已读取:', accessKeySecret ? 'yes (len=' + accessKeySecret.length + ')' : 'NO')
if (!accessKeyId || !accessKeySecret) { console.log('凭据不完整，终止'); process.exit(1) }

const creds = { accessKeyId, accessKeySecret, securityToken: refs.ALIBABA_CLOUD_SECURITY_TOKEN || '' }

// ---- 测试 1：代金券 ----
console.log('\n=== 1. DescribeCoupon (2023-09-30) ===')
try {
  const r = await queryCoupons(creds)
  console.log('结果: 成功')
  console.log('  可用券数 :', r.total.count)
  console.log('  面值合计 :', r.total.amount, r.total.currency)
  console.log('  剩余合计 :', r.total.remain, r.total.currency)
  console.log('  已用比例 :', r.total.percent.toFixed(1) + '%')
  if (r.upcoming) console.log('  最近到期 :', r.upcoming.endTime)
  if (r.coupons.length) {
    console.log('  明细（前 5 张）:')
    for (const c of r.coupons.slice(0, 5)) {
      console.log(`    - 面值 ${c.amount} / 剩余 ${c.remain} | ${c.status} | ${c.typeName || '-'} | 到期 ${c.endTime || '-'}`)
    }
  } else {
    console.log('  明细: (无券)')
  }
} catch (e) {
  console.log('结果: 失败')
  console.log('  错误:', e.message)
}

// ---- 测试 2：账户余额 ----
console.log('\n=== 2. QueryAccountBalance (2017-12-14) ===')
try {
  const b = await queryBalance(creds)
  console.log('结果: 成功')
  console.log('  可用额度 AvailableAmount    :', b.available, b.currency)
  console.log('  可用现金 AvailableCashAmount:', b.cash, b.currency)
  console.log('  信用额度 CreditAmount       :', b.credit, b.currency)
} catch (e) {
  console.log('结果: 失败')
  console.log('  错误:', e.message)
}
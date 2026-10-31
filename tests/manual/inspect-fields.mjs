// 用真实响应验证归一化：打印完整券对象的关键字段，确认 RemainAmount 等是否存在。
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { signRequest, ENDPOINT, ACTION_DESCRIBE_COUPON, API_VERSION } from '../../src/aliyun.js'

const CRED = process.env.DSH_CREDENTIALS_FILE || join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
function readRefs(text) {
  const refs = {}; let on = false
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) { on = true; continue }
    if (on) { if (/^\S/.test(line)) break; const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/); if (m) refs[m[1]] = m[2].trim() }
  }
  return refs
}
const refs = readRefs(fs.readFileSync(CRED, 'utf8'))

const body = JSON.stringify({ CurrentPage: 1, PageSize: 100 })
const init = signRequest(refs.ALIBABA_CLOUD_ACCESS_KEY_ID, refs.ALIBABA_CLOUD_ACCESS_KEY_SECRET, ACTION_DESCRIBE_COUPON, body, '', { version: API_VERSION })
const res = await fetch(ENDPOINT, init)
const data = await res.json()

console.log('HTTP', res.status)
console.log('Top-level:', Object.keys(data).join(', '))
console.log('TotalCount:', data.TotalCount)

const arr = Array.isArray(data.Data) ? data.Data : []
console.log('实际券数量:', arr.length)

for (const [i, c] of arr.entries()) {
  console.log(`\n--- 第 ${i + 1} 张券的完整字段 ---`)
  for (const [k, v] of Object.entries(c)) {
    if (k === 'YhOrderTypes') { console.log(`  ${k}: <${Array.isArray(v) ? v.length : 0} items>`); continue }
    console.log(`  ${k}: ${JSON.stringify(v)}`)
  }
}
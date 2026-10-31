/**
 * 今日消耗读取 —— 来自 dsh-cost-meter 的账本。
 *
 * cost-meter 把每日用量写在 `$DSH_HOME/storages/cost-meter/ledger.json` 的
 * `days[YYYY-MM-DD]` 下，含 token 桶与费用：
 *   input / output / cacheRead / cacheWrite / reasoning / calls
 *   cost / costCny / costEur（按配置的 currency 选择展示币种）
 *
 * 设计取舍：
 *  - 只读文件，不调用 cost-meter 的服务（避免跨插件耦合与版本依赖）
 *  - 文件缺失、损坏、没有今日条目时返回 ok:false，调用方据此隐藏该行
 *  - 绝不因账本问题影响阿里云数据的展示
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 本地日期键，与 cost-meter 的 localDayKey 口径一致。 */
function localDayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 按配置币种取出对应数额：CNY / EUR / USD。 */
function pickCost(day, currency) {
  if (currency === 'CNY') return num(day.costCny ?? day.cost)
  if (currency === 'EUR') return num(day.costEur ?? day.cost)
  return num(day.cost)
}

/**
 * 读取今日消耗。
 * @returns {{ok:boolean, tokens?:number, input?:number, output?:number,
 *            cacheRead?:number, calls?:number, cost?:number, currency?:string,
 *            date?:string, error?:string}}
 */
export function readTodayUsage(now = new Date()) {
  const ledgerPath = join(dshHome(), 'storages', 'cost-meter', 'ledger.json')
  let raw
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8')
  } catch {
    // 未安装 cost-meter，或尚未产生账本：静默隐藏，不算错误
    return { ok: false, missing: true, error: '未检测到 dsh-cost-meter 账本' }
  }

  let ledger
  try {
    ledger = JSON.parse(raw)
  } catch {
    return { ok: false, error: '账本文件无法解析' }
  }

  const days = ledger?.days
  if (!days || typeof days !== 'object') {
    return { ok: false, error: '账本缺少 days 字段' }
  }

  const date = localDayKey(now)
  const day = days[date]
  if (!day || typeof day !== 'object') {
    // 今天还没用过，视为 0
    return { ok: true, date, tokens: 0, input: 0, output: 0, cacheRead: 0, calls: 0, cost: 0, currency: 'CNY' }
  }

  const input = num(day.input)
  const output = num(day.output)
  const cacheRead = num(day.cacheRead)
  const cacheWrite = num(day.cacheWrite)
  const reasoning = num(day.reasoning)

  // token 总量口径：输入 + 输出 + 缓存读写（与费用插件展示的 total 一致）
  const tokens = input + output + cacheRead + cacheWrite + reasoning

  const currency = String(ledger?.config?.currency || 'CNY')

  return {
    ok: true,
    date,
    tokens,
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    calls: num(day.calls),
    cost: pickCost(day, currency),
    currency,
  }
}
/**
 * dsh-aliyun-coupon-api —— 主机端插件。
 *
 * 注册一条只读 HTTP 路由，供浏览器挂件取数：
 *   GET  /api/aliyun-coupon/balance → 代金券余额（30 秒节流 + 缓存）
 *   POST /api/aliyun-coupon/refresh → 强制刷新
 *   GET  /api/aliyun-coupon/diag    → 自检（不含任何密钥）
 *
 * 安全边界：
 *  - 只读调用 DescribeCoupon，没有任何写操作
 *  - 密钥只从 DSH credentials 服务或环境变量读取，永不回传浏览器
 *  - 路由用 connection.admit 鉴权，缺失该服务时拒绝（fail-closed）
 */
import { queryCoupons, queryBalance, CREDENTIAL_VARS } from './aliyun.js'
import { readTodayUsage } from './usage.js'
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'aliyun-coupon-api'

const API_PREFIX = '/api/aliyun-coupon'
// 缓存与前端轮询同为 5 分钟：正常轮询不会穿透缓存重复打阿里云接口。
const CACHE_MS = 5 * 60_000
// 手动刷新（点卡片）的最短间隔，防止连点。
const MIN_REFRESH_MS = 30_000

/**
 * 读取一个凭据。三级回落：
 *   1. DSH credentials 服务（resolve 返回 { value, source }）
 *   2. $DSH_HOME/.credentials.yaml 的 refs 段（服务不可用时的直接兜底）
 *   3. 同名环境变量
 * @returns {Promise<string>} 空字符串表示未配置
 */
async function readCredential(ctx, key) {
  // 1) credentials 服务
  try {
    const credentials = ctx.get?.('credentials')
    if (credentials && typeof credentials.resolve === 'function') {
      // 不同版本入参形态不同：品牌字符串 / { name } / { key }，逐个尝试
      for (const arg of [key, { name: key }, { key }]) {
        try {
          const hit = await credentials.resolve(arg)
          if (typeof hit === 'string' && hit.trim()) return hit.trim()
          if (typeof hit?.value === 'string' && hit.value.trim()) return hit.value.trim()
        } catch { /* 试下一个形态 */ }
      }
    }
  } catch { /* 服务不可用，继续回落 */ }

  // 2) 直接读凭据文件的 refs 段（用官方包的解析器，避免自己实现 YAML）
  const fromFile = readRefFromFile(key)
  if (fromFile) return fromFile

  // 3) 环境变量
  return String(process.env[key] ?? '').trim()
}

/** 解析 $DSH_HOME/.credentials.yaml 的 refs 段，取出某个键。 */
function readRefFromFile(key) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, '.credentials.yaml')
    const text = fs.readFileSync(file, 'utf8')
    // 只关心 refs: 段下的顶层键，逐行解析（该段结构简单，无需完整 YAML）
    let inRefs = false
    for (const line of text.split(/\r?\n/)) {
      if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
      if (!inRefs) continue
      if (/^\S/.test(line)) break // 离开 refs 段
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
      if (m && m[1] === key) {
        // 去掉可能的引号与行尾注释
        let v = m[2].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        }
        return v.trim()
      }
    }
  } catch { /* 文件不存在或不可读 */ }
  return ''
}

async function readAllCredentials(ctx) {
  const [accessKeyId, accessKeySecret, securityToken] = await Promise.all([
    readCredential(ctx, CREDENTIAL_VARS.accessKeyId),
    readCredential(ctx, CREDENTIAL_VARS.accessKeySecret),
    readCredential(ctx, CREDENTIAL_VARS.securityToken),
  ])
  return { accessKeyId, accessKeySecret, securityToken }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function apply(ctx) {
  let cached = null
  let cachedAt = 0
  let inflight = null
  let lastAttemptAt = 0

  /**
   * 鉴权：复用 DSH 的 connection 服务。
   * fail-closed —— 拿不到 connection 服务时拒绝，而不是放行。
   */
  const authorize = (req) => {
    let connection
    try { connection = ctx.get?.('connection') } catch { connection = null }
    if (!connection || typeof connection.admit !== 'function') {
      return { ok: false, status: 503, reason: '当前 DSH 缺少 connection 服务，已拒绝访问' }
    }
    try {
      const admission = connection.admit(req)
      if (admission && typeof admission === 'object') {
        if ('peer' in admission && admission.peer) return { ok: true }
        if ('rejection' in admission) return { ok: false, status: admission.rejection === 403 ? 403 : 401 }
      }
      return { ok: false, status: 401 }
    } catch {
      return { ok: false, status: 403 }
    }
  }

  const load = async (force) => {
    const now = Date.now()
    // 只缓存成功结果。"未配置"与"查询失败"应当很快重试，
    // 否则用户填好凭据或阿里云恢复后，还要干等一个完整的缓存周期。
    if (!force && cached && cached.ok && now - cachedAt < CACHE_MS) {
      return { ...cached, cached: true }
    }
    if (inflight) return inflight
    if (now - lastAttemptAt < MIN_REFRESH_MS && cached && cached.ok) {
      return { ...cached, cached: true, throttled: true }
    }

    lastAttemptAt = now
    inflight = (async () => {
      // 今日消耗与阿里云无关，任何时候都尝试读取（失败则隐藏该行）
      const usage = readTodayUsage()

      const creds = await readAllCredentials(ctx)
      if (!creds.accessKeyId || !creds.accessKeySecret) {
        // 不写入 cached：下次请求立即重试，用户配置凭据后无需等待
        return {
          ok: false,
          configured: false,
          fetchedAt: new Date().toISOString(),
          usage,
          error: '未配置阿里云 AccessKey（需要 RAM 只读子账号的 AccessKey ID / Secret）',
        }
      }
      try {
        // 两个接口并行查询；任一失败不影响另一个，各自记录错误。
        const [couponOut, balanceOut] = await Promise.allSettled([
          queryCoupons(creds),
          queryBalance(creds),
        ])

        const errors = []
        let coupon = null
        let balance = null

        if (couponOut.status === 'fulfilled') {
          coupon = couponOut.value
        } else {
          errors.push('代金券：' + (couponOut.reason?.message || String(couponOut.reason)))
        }

        if (balanceOut.status === 'fulfilled') {
          balance = balanceOut.value
        } else {
          errors.push('余额：' + (balanceOut.reason?.message || String(balanceOut.reason)))
        }

        // 两个都失败才算失败；只成功一个也照常展示
        const ok = coupon !== null || balance !== null
        const payload = {
          ok,
          configured: true,
          fetchedAt: new Date().toISOString(),
          usage,
          coupon,
          balance,
          ...(errors.length ? { errors } : {}),
          ...(ok ? {} : { error: errors.join('；') || '查询失败' }),
        }
        if (ok) {
          cached = payload
          cachedAt = Date.now()
        } else {
          payload.stale = cached && cached.ok ? cached : null
        }
        return payload
      } catch (err) {
        const payload = {
          ok: false,
          configured: true,
          fetchedAt: new Date().toISOString(),
          usage,
          error: err?.message || String(err),
          // 失败时保留上一次成功读数，标注为过期
          stale: cached && cached.ok ? cached : null,
        }
        return payload
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  const handler = async (req, res) => {
    const auth = authorize(req)
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.reason || '未授权：请通过 DSH 界面访问' })
      return
    }

    let pathname
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch {
      sendJson(res, 400, { ok: false, error: '请求路径无效' })
      return
    }

    try {
      if (pathname === API_PREFIX + '/diag') {
        const creds = await readAllCredentials(ctx)
        sendJson(res, 200, {
          ok: true,
          version: '1.0.0',
          endpoint: 'https://business.aliyuncs.com/',
          action: 'DescribeCoupon',
          hasCredentials: Boolean(creds.accessKeyId && creds.accessKeySecret),
          cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
        })
        return
      }
      if (pathname === API_PREFIX + '/balance' || pathname === API_PREFIX + '/refresh') {
        if (req.method && req.method !== 'GET' && req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '方法不允许' })
          return
        }
        const force = pathname === API_PREFIX + '/refresh'
        const payload = await load(force)
        sendJson(res, 200, payload)
        return
      }
      sendJson(res, 404, { ok: false, error: '未找到' })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || String(err) })
    }
  }

  // 路由注册：优先 ctx.webServer，其次常见别名；都不可用则尝试 get('webServer')
  const candidates = ['webServer', 'web-server', 'httpServer', 'server']
  ctx.effect(() => {
    let dispose = null
    for (const name of candidates) {
      let service
      try { service = ctx.get?.(name) } catch { service = null }
      if (service && typeof service.register === 'function') {
        const off = service.register({ kind: 'prefix', path: API_PREFIX, handler })
        dispose = typeof off === 'function' ? off : () => {}
        break
      }
    }
    return () => { if (dispose) dispose() }
  }, 'aliyun-coupon-api: routes')
}
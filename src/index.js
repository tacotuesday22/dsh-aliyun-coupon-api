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
/** 插件版本，与 package.json 保持一致（用于 diag 自检）。 */
const PLUGIN_VERSION = '1.6.2'
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

/**
 * 判断凭据实际来自哪个来源，供 UI 提示用户该去哪里清除。
 * @returns {'store'|'file'|'env'|'none'}
 */
async function credentialSource(ctx, key) {
  try {
    const credentials = ctx.get?.('credentials')
    if (credentials && typeof credentials.resolve === 'function') {
      for (const arg of [key, { name: key }, { key }]) {
        try {
          const hit = await credentials.resolve(arg)
          const v = typeof hit === 'string' ? hit : hit?.value
          if (typeof v === 'string' && v.trim()) return 'store'
        } catch { /* 下一个形态 */ }
      }
    }
  } catch { /* 忽略 */ }
  if (readRefFromFile(key)) return 'file'
  return String(process.env[key] ?? '').trim() ? 'env' : 'none'
}

/**
 * 从 $DSH_HOME/.credentials.yaml 的 refs 段移除指定键（只删相关行，其余原样保留）。
 * @returns {boolean} 是否实际修改了文件
 */
function removeRefFromFile(keys) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, '.credentials.yaml')
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    const out = []
    let inRefs = false
    let changed = false
    for (const line of lines) {
      if (/^refs:\s*$/.test(line)) { inRefs = true; out.push(line); continue }
      if (inRefs && /^\S/.test(line)) inRefs = false
      if (inRefs) {
        const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/)
        if (m && keys.includes(m[1])) { changed = true; continue } // 丢弃这一行
      }
      out.push(line)
    }
    if (changed) fs.writeFileSync(file, out.join('\n'), 'utf8')
    return changed
  } catch { return false }
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

/** 读取请求体，带大小上限（配置接口只需要很小的 JSON）。 */
const MAX_BODY_BYTES = 8192
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        try { req.destroy() } catch { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  let cached = null
  let cachedAt = 0
  let inflight = null
  let lastAttemptAt = 0

  /**
   * 鉴权：复用 DSH 的 connection 服务。
   * fail-closed —— 拿不到 connection 服务时拒绝，而不是放行。
   *
   * 例外：`/diag` 允许本机回环直连免鉴权，便于用 curl 排查。
   * diag 只返回状态与错误文本，不返回任何金额或密钥。
   */
  const isLoopback = (req) => {
    const addr = req?.socket?.remoteAddress || ''
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }

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
    // 今日消耗来自本地账本，读取成本极低，每次都重新读——
    // 绝不能跟着阿里云数据一起缓存，否则会滞后一个完整周期。
    const freshUsage = readTodayUsage()

    // 只缓存成功结果。"未配置"与"查询失败"应当很快重试，
    // 否则用户填好凭据或阿里云恢复后，还要干等一个完整的缓存周期。
    if (!force && cached && cached.ok && now - cachedAt < CACHE_MS) {
      // 用缓存的阿里云数据 + 新鲜的本地消耗
      return { ...cached, usage: freshUsage, cached: true }
    }
    if (inflight) return inflight
    if (now - lastAttemptAt < MIN_REFRESH_MS && cached && cached.ok) {
      return { ...cached, usage: freshUsage, cached: true, throttled: true }
    }

    lastAttemptAt = now
    inflight = (async () => {
      // 今日消耗与阿里云无关，任何时候都尝试读取（失败则隐藏该行）
      const usage = freshUsage

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
    let pathname
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch {
      sendJson(res, 400, { ok: false, error: '请求路径无效' })
      return
    }

    // /diag 允许本机回环免鉴权（只返回状态，不含金额与密钥）；其余接口一律鉴权
    const diagOpen = pathname === API_PREFIX + '/diag' && isLoopback(req)
    if (!diagOpen) {
      const auth = authorize(req)
      if (!auth.ok) {
        sendJson(res, auth.status, { ok: false, error: auth.reason || '未授权：请通过 DSH 界面访问' })
        return
      }
    }

    try {
      // ── 配置读取：只返回状态，绝不返回密钥 ──
      if (pathname === API_PREFIX + '/config' && req.method !== 'POST' && req.method !== 'DELETE') {
        const creds = await readAllCredentials(ctx)
        let writable = false
        try {
          const credentials = ctx.get?.('credentials')
          if (credentials && typeof credentials.describe === 'function') {
            const info = await credentials.describe(CREDENTIAL_VARS.accessKeyId)
            writable = Boolean(info && info.writable !== false)
          }
        } catch { /* 只读环境 */ }

        // 凭据来自哪里：store（可由界面清除）/ file（需手改文件）/ env（需改环境变量）
        const source = await credentialSource(ctx, CREDENTIAL_VARS.accessKeyId)

        sendJson(res, 200, {
          ok: true,
          configured: Boolean(creds.accessKeyId && creds.accessKeySecret),
          // 只暴露 AK 的末四位，便于用户辨认，无法还原
          akTail: creds.accessKeyId ? creds.accessKeyId.slice(-4) : '',
          source,
          writable,
        })
        return
      }

      // ── 配置保存：写入凭据并立即验证 ──
      if (pathname === API_PREFIX + '/config' && req.method === 'POST') {
        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { ok: false, error: '请求格式错误' })
          return
        }

        const ak = String(body?.accessKeyId || '').trim()
        const sk = String(body?.accessKeySecret || '').trim()

        if (!ak || !sk) {
          sendJson(res, 400, { ok: false, error: 'AccessKey ID 和 Secret 都不能为空' })
          return
        }
        // 格式校验：拦住最常见的错误——填成模型 API Key
        if (!/^LTAI[0-9A-Za-z]{8,}$/.test(ak)) {
          sendJson(res, 400, {
            ok: false,
            error: 'AccessKey ID 应以 LTAI 开头。' +
              (/^sk-/.test(ak) ? '你填的看起来是模型 API Key，不是阿里云 RAM AccessKey。' : ''),
          })
          return
        }
        if (sk.length < 16) {
          sendJson(res, 400, { ok: false, error: 'AccessKey Secret 长度不正确，请检查是否复制完整' })
          return
        }

        // 先验证再保存：避免把错误的 Key 写进凭据库
        try {
          await queryCoupons({ accessKeyId: ak, accessKeySecret: sk })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err?.message || String(err), stage: 'verify' })
          return
        }

        // 验证通过才写入
        const credentials = ctx.get?.('credentials')
        if (!credentials || typeof credentials.set !== 'function') {
          sendJson(res, 501, {
            ok: false,
            error: '当前 DSH 未提供可写入的凭据服务，请手动编辑 ~/.dsh/.credentials.yaml',
            stage: 'store',
          })
          return
        }
        try {
          await credentials.set(CREDENTIAL_VARS.accessKeyId, ak)
          await credentials.set(CREDENTIAL_VARS.accessKeySecret, sk)
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: '保存失败：' + (err?.message || String(err)),
            stage: 'store',
          })
          return
        }

        // 清掉旧缓存，让下次读取立刻用新凭据
        cached = null
        cachedAt = 0

        sendJson(res, 200, { ok: true, message: '配置成功', akTail: ak.slice(-4) })
        return
      }

      // ── 测试连接：用当前已保存的凭据实际调用一次 ──
      if (pathname === API_PREFIX + '/test') {
        const creds = await readAllCredentials(ctx)
        if (!creds.accessKeyId || !creds.accessKeySecret) {
          sendJson(res, 200, { ok: false, error: '尚未配置 AccessKey' })
          return
        }
        try {
          const r = await queryCoupons(creds)
          sendJson(res, 200, {
            ok: true,
            count: r.total.count,
            remain: r.total.remain,
            currency: r.total.currency,
          })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: err?.message || String(err) })
        }
        return
      }

      // ── 清除凭据 ──
      // 同时清理 credentials 服务与凭据文件，否则文件里的旧值会继续生效，
      // 用户会以为"清除了但还显示已配置"。
      if (pathname === API_PREFIX + '/config' && req.method === 'DELETE') {
        const notes = []
        const credentials = ctx.get?.('credentials')
        if (credentials && typeof credentials.unset === 'function') {
          try {
            await credentials.unset(CREDENTIAL_VARS.accessKeySecret)
            await credentials.unset(CREDENTIAL_VARS.accessKeyId)
          } catch (err) {
            notes.push('凭据服务清除失败：' + (err?.message || String(err)))
          }
        }
        // 文件兜底也要清，否则读凭据时会重新读到
        const fileCleared = removeRefFromFile([CREDENTIAL_VARS.accessKeyId, CREDENTIAL_VARS.accessKeySecret])
        if (fileCleared) notes.push('已从 .credentials.yaml 移除')

        if (String(process.env[CREDENTIAL_VARS.accessKeyId] || '').trim()) {
          notes.push('注意：环境变量中仍存在同名变量，需自行删除后重启')
        }

        cached = null
        cachedAt = 0
        sendJson(res, 200, { ok: true, message: '已清除', notes })
        return
      }

      if (pathname === API_PREFIX + '/diag') {
        const creds = await readAllCredentials(ctx)
        // 运行时诊断：服务可用性、凭据来源、一次探测性调用的结果
        let credentialsServiceState = 'absent'
        try {
          const s = ctx.get?.('credentials')
          if (s) {
            credentialsServiceState = typeof s.resolve === 'function' ? 'ok' : 'no-resolve'
          }
        } catch (e) {
          credentialsServiceState = 'throws:' + (e?.message || String(e))
        }

        let probe = null
        if (creds.accessKeyId && creds.accessKeySecret) {
          try {
            const r = await queryCoupons(creds)
            probe = { ok: true, count: r.total.count, remain: r.total.remain }
          } catch (e) {
            probe = { ok: false, error: e?.message || String(e), name: e?.name, code: e?.code }
          }
        }

        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          endpoint: 'https://business.aliyuncs.com/',
          action: 'DescribeCoupon',
          hasCredentials: Boolean(creds.accessKeyId && creds.accessKeySecret),
          akLength: creds.accessKeyId ? creds.accessKeyId.length : 0,
          skLength: creds.accessKeySecret ? creds.accessKeySecret.length : 0,
          credentialsService: credentialsServiceState,
          dshHome: process.env.DSH_HOME || null,
          nodeVersion: process.version,
          probe,
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

  // 路由注册：用声明式注入。
  //
  // 关键：不能在 apply 时直接 ctx.get('webServer')。
  // Cordis 的服务是异步就绪的，apply 执行时 webServer 往往还没注册完，
  // get() 会返回 undefined，路由静默失效（这就是之前"读取失败"的根因）。
  // ctx.inject(deps, cb) 会在依赖就绪后再调用 cb —— 费用插件用的也是这个方式。
  ctx.inject(['webServer'], (scope) => {
    const service = scope.webServer || scope.get('webServer')
    if (!service || typeof service.register !== 'function') return
    const dispose = service.register({ kind: 'prefix', path: API_PREFIX, handler })
    scope.effect(() => () => { if (typeof dispose === 'function') dispose() }, 'aliyun-coupon-api: routes')
  })
}
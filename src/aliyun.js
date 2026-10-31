/**
 * 阿里云代金券查询 —— 官方 OpenAPI 实现。
 *
 * 接口：BssOpenApi 2023-09-30 DescribeCoupon
 * 文档：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2023-09-30-describecoupon
 * 权限：bss:DescribeCoupon（只读）
 * 签名：ACS3-HMAC-SHA256
 *
 * 设计约束：
 *  - 只用 RAM AccessKey（绝不需要账号密码）
 *  - 只发 POST 到 https://business.aliyuncs.com/，不跟随重定向
 *  - 只读，不做任何写操作
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'

export const ENDPOINT = 'https://business.aliyuncs.com/'

/**
 * 注意：两个接口属于同一产品的不同版本，x-acs-version 必须分别指定。
 *   DescribeCoupon      → 2023-09-30（代金券列表）
 *   QueryAccountBalance → 2017-12-14（账户余额）
 * 签名算法相同（ACS3-HMAC-SHA256）。
 */
export const API_VERSION = '2023-09-30'
export const ACTION_DESCRIBE_COUPON = 'DescribeCoupon'

export const BALANCE_VERSION = '2017-12-14'
export const ACTION_QUERY_BALANCE = 'QueryAccountBalance'

/** 凭据引用名。用 DSH credentials 服务存储，也可用同名环境变量提供。 */
export const CREDENTIAL_VARS = {
  accessKeyId: 'ALIBABA_CLOUD_ACCESS_KEY_ID',
  accessKeySecret: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  securityToken: 'ALIBABA_CLOUD_SECURITY_TOKEN',
}

const MAX_BYTES = 1 << 20

const sha256Hex = value => createHash('sha256').update(value).digest('hex')

/**
 * 构造一个 ACS3-HMAC-SHA256 签名请求。
 * 参考：https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
 */
export function signRequest(accessKeyId, accessKeySecret, action, body = '', securityToken = '', { now = new Date(), nonce = randomUUID(), version = API_VERSION } = {}) {
  const headers = {
    host: 'business.aliyuncs.com',
    'x-acs-action': action,
    'x-acs-version': version,
    'x-acs-date': now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': nonce,
    'x-acs-content-sha256': sha256Hex(body),
    'content-type': 'application/json; charset=utf-8',
  }
  if (securityToken) headers['x-acs-security-token'] = securityToken

  const keys = Object.keys(headers).sort()
  const signedHeaders = keys.join(';')
  const canonicalHeaders = keys.map(k => `${k}:${headers[k].trim()}\n`).join('')
  const canonical = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n')
  const signature = createHmac('sha256', accessKeySecret)
    .update(`ACS3-HMAC-SHA256\n${sha256Hex(canonical)}`)
    .digest('hex')

  return {
    method: 'POST',
    headers: {
      ...headers,
      authorization: `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
      accept: 'application/json',
    },
    body,
    redirect: 'manual',
  }
}

/** 把金额字符串安全地转成数字；无法识别时返回 null（绝不当作 0）。 */
function toAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * 把 DescribeCoupon 的响应归一化成挂件需要的形状。
 * 返回 null 表示响应不可用（调用方据此报错而不是显示 0）。
 */
export function normalizeCoupons(data, { now = Date.now() } = {}) {
  if (!data || typeof data !== 'object') return null
  // 阿里云出错时会返回 Code/Message，而不是 Data
  if (data.Code && data.Code !== 'Success') {
    return { error: data.Code, message: data.Message || '' }
  }
  const list = Array.isArray(data.Data) ? data.Data : (Array.isArray(data.Data?.CouponInfo) ? data.Data.CouponInfo : [])
  if (!Array.isArray(list)) return null

  const coupons = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const amount = toAmount(item.Amount)
    const remain = toAmount(item.RemainAmount)
    if (amount === null && remain === null) continue

    const endTime = typeof item.EndTime === 'string' ? item.EndTime : ''
    const endMs = endTime ? Date.parse(endTime) : NaN
    const expired = Number.isFinite(endMs) ? endMs <= now : false
    const status = String(item.Status || '')
    const usable = !expired && !/expire|invalid|used|frozen/i.test(status)

    coupons.push({
      couponNo: String(item.CouponNo || ''),
      amount,
      remain,
      status,
      usable,
      expired,
      endTime,
      endMs: Number.isFinite(endMs) ? endMs : null,
      startTime: String(item.StartTime || ''),
      typeName: String(item.CouponTypeName || ''),
      items: Array.isArray(item.ItemNames) ? item.ItemNames.map(String) : [],
      remark: String(item.Remark || ''),
      currency: String(item.Currency || 'CNY'),
    })
  }

  // 只统计仍然可用的券
  const usable = coupons.filter(c => c.usable && c.remain !== null)
  const remainSum = usable.reduce((sum, c) => sum + (c.remain || 0), 0)
  const amountSum = usable.reduce((sum, c) => sum + (c.amount || 0), 0)

  // 最早到期的一张可用券
  const upcoming = usable
    .filter(c => c.endMs !== null)
    .sort((a, b) => a.endMs - b.endMs)[0] || null

  return {
    coupons,
    total: {
      remain: remainSum,
      amount: amountSum,
      used: Math.max(0, amountSum - remainSum),
      percent: amountSum > 0 ? Math.min(100, ((amountSum - remainSum) / amountSum) * 100) : 0,
      currency: coupons[0]?.currency || 'CNY',
      count: usable.length,
    },
    upcoming: upcoming ? { endMs: upcoming.endMs, endTime: upcoming.endTime, remain: upcoming.remain } : null,
  }
}

async function readJson(response) {
  const len = Number(response.headers.get('content-length'))
  if (Number.isFinite(len) && len > MAX_BYTES) throw new Error('响应过大')
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new Error('响应过大')
  try { return JSON.parse(text) } catch { throw new Error('响应不是合法 JSON') }
}

/**
 * 调用 DescribeCoupon。
 * @returns 归一化后的结果，或抛出带可读 message 的错误
 */
export async function queryCoupons({ accessKeyId, accessKeySecret, securityToken = '' }, { fetchImpl = fetch, signal } = {}) {
  if (!accessKeyId || !accessKeySecret) {
    throw Object.assign(new Error('未配置阿里云 AccessKey'), { soft: true })
  }
  signal?.throwIfAborted()

  // 重要：不要传 Status 过滤。
  // 阿里云返回的状态枚举是全大写的 AVAILABLE，而文档示例写的是 Available；
  // 大小写不匹配时接口会静默返回空数组（实测踩过）。改为拉全量后在本地按状态判断，
  // 这样无论服务端用哪种大小写、以后是否新增状态都能正确处理。
  const body = JSON.stringify({ CurrentPage: 1, PageSize: 100 })
  const init = signRequest(accessKeyId, accessKeySecret, ACTION_DESCRIBE_COUPON, body, securityToken)

  let response
  try {
    response = await fetchImpl(ENDPOINT, { ...init, signal })
  } catch (err) {
    signal?.throwIfAborted()
    throw new Error('网络请求失败：' + (err?.message || String(err)))
  }

  if (!response.ok) {
    // 不把阿里云原始错误体直接抛给前端，避免泄露账户标识
    if (response.status === 401 || response.status === 403) {
      throw new Error('鉴权失败：请检查 AccessKey 是否正确、是否已授予 bss:DescribeCoupon 权限')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('接口返回重定向，已拒绝转发凭据')
    }
    throw new Error('阿里云返回 HTTP ' + response.status)
  }

  const data = await readJson(response)
  const normalized = normalizeCoupons(data)
  if (!normalized) throw new Error('响应结构无法识别')
  if (normalized.error) {
    if (/Forbidden|NoPermission|Unauthorized/i.test(normalized.error)) {
      throw new Error('无权限调用 DescribeCoupon（' + normalized.error + '）')
    }
    throw new Error('阿里云返回错误：' + normalized.error)
  }
  return normalized
}

/**
 * 归一化 QueryAccountBalance 响应。
 *
 * 字段含义（官方文档）：
 *   AvailableAmount     — 可用额度（含信控等因素）
 *   AvailableCashAmount — 可用现金余额
 *   CreditAmount        — 信用额度
 *   QuotaLimit          — 生态客户额度
 * 注意：AvailableAmount 不等于"现金余额"，也不等于"消费额"，需要分开展示。
 */
export function normalizeBalance(data) {
  if (!data || typeof data !== 'object') return null
  if (data.Code && String(data.Code) !== '200' && data.Code !== 'Success') {
    return { error: String(data.Code), message: String(data.Message || '') }
  }
  if (data.Success === false) {
    return { error: String(data.Code || 'Failed'), message: String(data.Message || '') }
  }
  const d = data.Data
  if (!d || typeof d !== 'object') return null

  const available = toAmount(d.AvailableAmount)
  const cash = toAmount(d.AvailableCashAmount)
  const credit = toAmount(d.CreditAmount)
  if (available === null && cash === null) return null

  return {
    available,
    cash,
    credit,
    currency: String(d.Currency || 'CNY'),
  }
}

/**
 * 调用 QueryAccountBalance（2017-12-14 版本）。
 * 该接口无请求参数；仍以空 JSON 体签名，保证 x-acs-content-sha256 一致。
 */
export async function queryBalance({ accessKeyId, accessKeySecret, securityToken = '' }, { fetchImpl = fetch, signal } = {}) {
  if (!accessKeyId || !accessKeySecret) {
    throw Object.assign(new Error('未配置阿里云 AccessKey'), { soft: true })
  }
  signal?.throwIfAborted()

  const body = '{}'
  const init = signRequest(accessKeyId, accessKeySecret, ACTION_QUERY_BALANCE, body, securityToken, { version: BALANCE_VERSION })

  let response
  try {
    response = await fetchImpl(ENDPOINT, { ...init, signal })
  } catch (err) {
    signal?.throwIfAborted()
    throw new Error('网络请求失败：' + (err?.message || String(err)))
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('鉴权失败：请检查 AccessKey 与 bss:Describe* 权限')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('接口返回重定向，已拒绝转发凭据')
    }
    throw new Error('阿里云返回 HTTP ' + response.status)
  }

  const data = await readJson(response)
  const normalized = normalizeBalance(data)
  if (!normalized) throw new Error('响应结构无法识别')
  if (normalized.error) {
    if (/Forbidden|NoPermission|NotAuthorized|Unauthorized/i.test(normalized.error)) {
      throw new Error('无权限查询余额（' + normalized.error + '）')
    }
    throw new Error('阿里云返回错误：' + normalized.error)
  }
  return normalized
}
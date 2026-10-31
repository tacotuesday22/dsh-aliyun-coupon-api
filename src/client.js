/**
 * dsh-aliyun-coupon-api —— 浏览器端挂件（客户端模块格式）。
 *
 * 侧边栏底部卡片，三行信息：
 *   今日消耗   <tokens>        ¥<金额>
 *   账户余额                   ¥<金额>
 *   代金券                     ¥<金额>
 *   面值 ¥300.00 · 1 张 · 355天后到期
 *
 * 数据来源：
 *   - 今日消耗：dsh-cost-meter 账本（若未安装则隐藏该行）
 *   - 账户余额 / 代金券：阿里云官方 OpenAPI（本插件 host 端）
 *
 * 视觉对齐 dsh-cost-meter：同样的字体层级、行距、主题令牌与圆角。
 *
 * 模块格式必须是 window.__ModuleLoader__.load({ id, factory })。
 */
window.__ModuleLoader__.load({
  id: 'dsh-aliyun-coupon-api',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const ROUTE = '/api/aliyun-coupon'

    /** 金额格式化：阿里云/账本可能给出多位小数，统一两位。 */
    const money = (n) => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      return '¥' + n.toFixed(2)
    }

    /** token 数量缩写，与费用插件口径一致（M = 百万）。 */
    const fmtTokens = (n) => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return String(Math.round(n))
    }

    const fmtRemain = (ms) => {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      const diff = ms - Date.now()
      if (diff <= 0) return '已过期'
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      if (days > 0) return `${days}天后到期`
      if (hours > 0) return `${hours}时${mins}分后到期`
      return `${mins}分后到期`
    }

    const STYLE_ID = 'aliyun-coupon-api-style'
    // 视觉严格对齐 dsh-cost-meter 的 .cm-bbox / .cm-foot：
    //   border:1px solid border-l1; border-radius:12px; padding:8px 10px;
    //   background:bg-layer-1; flex column; gap:6px
    // 该插件的"玻璃感"来自半透明的 bg-layer-* + 细边框 + 大圆角，不是 backdrop-filter。
    const CSS = `
.acp-card{
  display:flex;flex-direction:column;gap:6px;
  padding:8px 10px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#666));
  font-size:12px;line-height:1.45;
  font-variant-numeric:tabular-nums;
  box-sizing:border-box;width:100%;min-width:148px;
  cursor:pointer;user-select:none;
  transition:background .15s ease,border-color .15s ease;
  -webkit-app-region:no-drag;
}
.acp-card:hover{
  background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1)));
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.24));
}
.acp-row{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;}
.acp-label{
  display:inline-flex;align-items:center;gap:5px;
  white-space:nowrap;flex:none;
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#666));
}
.acp-title{
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
  font-weight:400;
}
.acp-val{
  font-weight:600;text-align:right;white-space:nowrap;
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
  overflow:hidden;text-overflow:ellipsis;
}
.acp-val.accent{color:var(--dsw-alias-state-business-primary,#3b82f6);}
.acp-sub{
  font-size:11px;line-height:1.4;
  color:var(--dsw-alias-label-tertiary,var(--dsw-alias-text-secondary,#888));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.acp-err{color:var(--dsw-alias-state-error-primary,#d9534f);}
.acp-dot{
  width:6px;height:6px;border-radius:50%;flex:none;display:inline-block;
  background:var(--dsw-alias-state-business-primary,#3b82f6);
}
.acp-dot.err{background:var(--dsw-alias-state-error-primary,#d9534f);}
.acp-dot.idle{background:var(--dsw-alias-label-tertiary,#999);opacity:.55;}
.acp-rail{display:flex;align-items:center;justify-content:center;padding:6px;}
`

    function injectStyle() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID)) return () => {}
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
      return () => { try { el.remove() } catch { /* ignore */ } }
    }

    function Card() {
      const [state, setState] = React.useState({ phase: 'loading', data: null })

      const load = React.useCallback(async (force) => {
        try {
          const res = await fetch(ROUTE + (force ? '/refresh' : '/balance'), { cache: 'no-store' })
          const data = await res.json()
          setState({ phase: 'ready', data })
        } catch (err) {
          setState({ phase: 'ready', data: { ok: false, error: String(err?.message || err) } })
        }
      }, [])

      React.useEffect(() => {
        load(false)
        // 每 30 秒拉一次前端数据。后端对阿里云数据有 5 分钟缓存（不会重复打 API），
        // 但今日消耗每次都实时读取本地账本，所以这样能保持消耗数字及时更新。
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return
          load(false)
        }, 30 * 1000)
        return () => clearInterval(timer)
      }, [load])

      const d = state.data
      const onClick = () => load(true)

      if (state.phase === 'loading' && !d) {
        return h('div', { className: 'acp-card' },
          h('div', { className: 'acp-row' },
            h('span', { className: 'acp-label' }, h('span', { className: 'acp-dot idle' }), '阿里云'),
            h('span', { className: 'acp-val' }, '读取中…')))
      }

      if (!d) return null

      if (d.configured === false) {
        return h('div', { className: 'acp-card', title: '需要配置 RAM 只读 AccessKey' },
          h('div', { className: 'acp-row' },
            h('span', { className: 'acp-label' }, h('span', { className: 'acp-dot idle' }), '阿里云'),
            h('span', { className: 'acp-val' }, '未配置')),
          h('div', { className: 'acp-sub' }, '需要 RAM 只读 AccessKey'))
      }

      if (!d.ok) {
        const stale = d.stale
        return h('div', { className: 'acp-card', title: d.error || '读取失败', onClick },
          h('div', { className: 'acp-row' },
            h('span', { className: 'acp-label' }, h('span', { className: 'acp-dot err' }), '阿里云'),
            h('span', { className: 'acp-val' }, stale ? '缓存' : '—')),
          h('div', { className: 'acp-sub acp-err' }, stale ? '刷新失败，显示上次结果' : '读取失败'))
      }

      const usage = d.usage
      const coupon = d.coupon
      const balance = d.balance
      const total = coupon?.total
      const up = coupon?.upcoming

      const rows = []

      // ── 今日消耗：与费用插件同一行式（左标签 + 灰字 token + 右金额）──
      if (usage && usage.ok) {
        rows.push(h('div', { key: 'today', className: 'acp-row' },
          h('span', { className: 'acp-label' },
            h('span', { className: 'acp-title' }, '今日'),
            h('span', { className: 'acp-sub' }, fmtTokens(usage.tokens) + ' tokens')),
          h('span', { className: 'acp-val' }, money(usage.cost))))
      }

      // ── 账户余额 ──
      if (balance) {
        rows.push(h('div', { key: 'bal', className: 'acp-row' },
          h('span', { className: 'acp-label acp-title' }, '余额'),
          h('span', { className: 'acp-val' }, money(balance.available))))
      }

      // ── 代金券 ──
      if (coupon) {
        rows.push(h('div', { key: 'cp', className: 'acp-row' },
          h('span', { className: 'acp-label acp-title' }, '代金券'),
          h('span', { className: 'acp-val accent' }, money(total.remain))))

        const sub = [`面值 ${money(total.amount)}`, `${total.count ?? 0} 张`]
        if (up) sub.push(fmtRemain(up.endMs))
        rows.push(h('div', { key: 'sub', className: 'acp-sub' }, sub.join(' · ')))
      }

      const titleParts = ['点击刷新 · 阿里云官方 API']
      if (d.errors && d.errors.length) titleParts.push('部分失败：' + d.errors.join('；'))

      return h('div', { className: 'acp-card', title: titleParts.join('\n'), onClick }, ...rows)
    }

    const inject = ['slots']

    function apply(ctx) {
      const releaseStyle = injectStyle()
      ctx.effect(() => releaseStyle, 'aliyun-coupon-api: style')

      const register = () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'aliyun-coupon-api',
        order: 10,
        inject: () => ({}),
      }, Card)

      ctx.slots.inject('sidebar.footer.action', register)
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
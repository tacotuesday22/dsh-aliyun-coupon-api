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
.acp-dot.setup{background:var(--dsw-alias-state-warning-primary,#f0ad4e);}
.acp-rail{display:flex;align-items:center;justify-content:center;padding:6px;}

/* ── 未配置状态：可点击的引导卡片 ── */
.acp-setup{border-color:var(--dsw-alias-state-warning-primary,#f0ad4e);}
.acp-val.setup{color:var(--dsw-alias-state-warning-primary,#f0ad4e);}

/* ── 设置页：凭据配置区块 ── */
.acp-setup-panel{
  display:flex;flex-direction:column;gap:12px;
  font-size:13px;line-height:1.6;
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#666));
  max-width:640px;
}
.acp-h{
  margin:0;font-size:15px;font-weight:600;
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
}
.acp-note{
  margin:0;font-size:12px;line-height:1.6;
  color:var(--dsw-alias-label-tertiary,var(--dsw-alias-text-secondary,#888));
}
.acp-note code,.acp-code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11.5px;padding:1px 5px;border-radius:4px;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
}
.acp-step{
  display:flex;flex-direction:column;gap:6px;
  padding:10px 12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));
}
.acp-step-head{display:flex;align-items:center;gap:8px;}
.acp-step-no{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;flex:none;
  font-size:11px;font-weight:600;
  background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;
}
.acp-step-title{
  font-weight:600;
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
}
.acp-step-body{display:flex;flex-direction:column;gap:8px;}
.acp-step-body p{margin:0;}
.acp-code-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.acp-btn{
  align-self:flex-start;
  padding:5px 12px;border-radius:8px;cursor:pointer;
  font-size:12px;font-weight:500;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
  transition:background .15s ease,border-color .15s ease,opacity .15s ease;
  font-family:inherit;
}
.acp-btn:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));
  border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.4));
}
.acp-btn:disabled{opacity:.5;cursor:not-allowed;}
.acp-btn.small{padding:3px 8px;font-size:11.5px;}
.acp-btn.primary{
  background:var(--dsw-alias-state-business-primary,#3b82f6);
  border-color:var(--dsw-alias-state-business-primary,#3b82f6);
  color:#fff;
}
.acp-btn.primary:hover:not(:disabled){opacity:.88;background:var(--dsw-alias-state-business-primary,#3b82f6);}
.acp-btn.danger{
  color:var(--dsw-alias-state-error-primary,#d9534f);
  border-color:var(--dsw-alias-state-error-primary,#d9534f);
  background:transparent;
}
.acp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;}
.acp-field{display:flex;flex-direction:column;gap:4px;font-size:12px;}
.acp-input-row{display:flex;gap:6px;align-items:center;}
.acp-input{
  flex:1;min-width:0;
  padding:6px 10px;border-radius:8px;
  font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));
  background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));
  color:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,#222));
  outline:none;
}
.acp-input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);}
.acp-status{
  padding:8px 12px;border-radius:8px;font-size:12.5px;
}
.acp-status.ok{background:rgba(52,168,83,.12);color:var(--dsw-alias-state-success-primary,#34a853);}
.acp-status.err{background:rgba(217,83,79,.12);color:var(--dsw-alias-state-error-primary,#d9534f);}
.acp-status.busy{background:rgba(59,130,246,.12);color:var(--dsw-alias-state-business-primary,#3b82f6);}
.acp-status.idle{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));}
.acp-foot-note{
  margin:0;font-size:11.5px;
  color:var(--dsw-alias-label-tertiary,var(--dsw-alias-text-secondary,#888));
}
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

    /**
     * 打开 DSH 设置页并定位到本插件的凭据区块。
     *
     * 实现方式：优先找设置按钮并点击；找不到时退化为在地址栏加 hash，
     * 由我们的设置区块自行滚动到可视区域（见 SetupSection 中的 hash 处理）。
     */
    const SETTINGS_HASH = '#aliyun-coupon-setup'
    function openSettings() {
      try {
        if (typeof window !== 'undefined') {
          window.location.hash = SETTINGS_HASH
          // 设置面板通常是侧边抽屉/弹窗，需要用户自己点开；
          // 这里同时尝试点击侧边栏底部的设置按钮以直达。
          const btn = findSettingsButton()
          if (btn) btn.click()
          // 等面板渲染后再滚动到目标区块
          setTimeout(() => {
            const el = typeof document !== 'undefined'
              ? document.getElementById('aliyun-coupon-setup-anchor')
              : null
            if (el && typeof el.scrollIntoView === 'function') {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }
          }, 600)
        }
      } catch { /* 静默失败，用户仍可手动进设置 */ }
    }

    /** 尽力找到侧边栏里的设置入口按钮。 */
    function findSettingsButton() {
      if (typeof document === 'undefined') return null
      const selectors = [
        '[data-slot="sidebar.settings"] button',
        '[data-slot="sidebar.settings"]',
        'button[aria-label*="设置"]',
        'button[aria-label*="Settings"]',
        'button[title*="设置"]',
        'button[title*="Settings"]',
      ]
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel)
          if (el) return el
        } catch { /* 无效选择器，继续 */ }
      }
      return null
    }

    // ── 阿里云控制台直达链接 ──
    const RAM_USERS = 'https://ram.console.aliyun.com/users'
    const RAM_POLICIES = 'https://ram.console.aliyun.com/policies'
    const POLICY_NAME = 'AliyunBSSReadOnlyAccess'

    /**
     * 设置页里的「阿里云凭据」区块。
     * 三步引导 + AccessKey 表单 + 保存并测试。
     */
    function SetupSection() {
      const [form, setForm] = React.useState({ ak: '', sk: '' })
      const [show, setShow] = React.useState({ ak: false, sk: false })
      const [status, setStatus] = React.useState({ kind: 'idle', text: '' })
      const [busy, setBusy] = React.useState(false)
      const [config, setConfig] = React.useState(null)
      const [copied, setCopied] = React.useState(false)

      const refreshConfig = React.useCallback(async () => {
        try {
          const r = await fetch(ROUTE + '/config', { cache: 'no-store' })
          const d = await r.json()
          if (d.ok) setConfig(d)
        } catch { /* 保持 null */ }
      }, [])

      React.useEffect(() => { refreshConfig() }, [refreshConfig])

      // 从卡片跳转过来时，滚动到本区块
      React.useEffect(() => {
        if (typeof window === 'undefined') return
        if (window.location.hash !== SETTINGS_HASH) return
        const t = setTimeout(() => {
          const el = document.getElementById('aliyun-coupon-setup-anchor')
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 300)
        return () => clearTimeout(t)
      }, [])

      const save = async () => {
        if (busy) return
        setBusy(true)
        setStatus({ kind: 'busy', text: '正在验证并保存…' })
        try {
          const r = await fetch(ROUTE + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessKeyId: form.ak.trim(), accessKeySecret: form.sk.trim() }),
          })
          const d = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }))
          if (d.ok) {
            setStatus({ kind: 'ok', text: '配置成功（AK 末四位 ' + (d.akTail || '') + '）' })
            setForm({ ak: '', sk: '' })
            refreshConfig()
          } else {
            setStatus({ kind: 'err', text: d.error || '保存失败' })
          }
        } catch (e) {
          setStatus({ kind: 'err', text: '请求失败：' + String(e?.message || e) })
        } finally {
          setBusy(false)
        }
      }

      const test = async () => {
        if (busy) return
        setBusy(true)
        setStatus({ kind: 'busy', text: '正在测试连接…' })
        try {
          const r = await fetch(ROUTE + '/test', { cache: 'no-store' })
          const d = await r.json()
          if (d.ok) {
            setStatus({
              kind: 'ok',
              text: `连接正常 · 读到 ${d.count} 张券，余额 ${d.currency} ${Number(d.remain).toFixed(2)}`,
            })
          } else {
            setStatus({ kind: 'err', text: d.error || '测试失败' })
          }
        } catch (e) {
          setStatus({ kind: 'err', text: '请求失败：' + String(e?.message || e) })
        } finally {
          setBusy(false)
        }
      }

      const clear = async () => {
        if (busy) return
        setBusy(true)
        setStatus({ kind: 'busy', text: '正在清除…' })
        try {
          const r = await fetch(ROUTE + '/config', { method: 'DELETE' })
          const d = await r.json()
          if (d.ok) {
            const extra = Array.isArray(d.notes) && d.notes.length ? '（' + d.notes.join('；') + '）' : ''
            setStatus({ kind: 'idle', text: '已清除配置' + extra })
          } else {
            setStatus({ kind: 'err', text: d.error || '清除失败' })
          }
          refreshConfig()
        } catch (e) {
          setStatus({ kind: 'err', text: '请求失败：' + String(e?.message || e) })
        } finally {
          setBusy(false)
        }
      }

      const copyPolicy = () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(POLICY_NAME)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          }
        } catch { /* 忽略 */ }
      }

      const open = (url) => {
        try { window.open(url, '_blank', 'noopener') } catch { /* 忽略 */ }
      }

      const step = (no, title, children) =>
        h('div', { className: 'acp-step' },
          h('div', { className: 'acp-step-head' },
            h('span', { className: 'acp-step-no' }, no),
            h('span', { className: 'acp-step-title' }, title)),
          children)

      const statusNode = status.text
        ? h('div', { className: 'acp-status ' + status.kind, role: 'status' },
            (status.kind === 'ok' ? '✓ ' : status.kind === 'err' ? '✗ ' : '') + status.text)
        : null

      return h('div', { id: 'aliyun-coupon-setup-anchor', className: 'acp-setup-panel' },
        h('h3', { className: 'acp-h' }, '阿里云凭据'),
        h('p', { className: 'acp-note' },
          '本插件通过阿里云官方 OpenAPI 只读查询余额与代金券，需要一对 RAM AccessKey。',
          h('br'),
          h('strong', null, '注意：这不是模型 API Key'),
          '（模型 Key 以 ', h('code', null, 'sk-'), ' 开头，这里需要的是以 ',
          h('code', null, 'LTAI'), ' 开头的 RAM AccessKey）。'),

        // 当前状态
        config && config.configured
          ? h('div', { className: 'acp-status ok' },
              '✓ 已配置（AK 末四位 ' + config.akTail + '）',
              config.source === 'file'
                ? h('div', { className: 'acp-foot-note', style: { marginTop: '4px' } },
                    '当前凭据来自 ~/.dsh/.credentials.yaml。「清除配置」会同时移除文件里的对应行。')
                : null,
              config.source === 'env'
                ? h('div', { className: 'acp-foot-note', style: { marginTop: '4px' } },
                    '当前凭据来自环境变量，需自行删除环境变量后重启才能清除。')
                : null)
          : h('div', { className: 'acp-status idle' }, '尚未配置'),

        step('1', '创建只读子账号',
          h('div', { className: 'acp-step-body' },
            h('p', null, '在阿里云 RAM 控制台创建一个子用户，勾选「使用永久 AccessKey 访问」，不要勾选「使用控制台访问」。'),
            h('button', { className: 'acp-btn', onClick: () => open(RAM_USERS) },
              '打开 RAM 用户控制台 ↗'))),

        step('2', '授予只读权限',
          h('div', { className: 'acp-step-body' },
            h('p', null, '给该子用户新增授权，选择系统策略：'),
            h('div', { className: 'acp-code-row' },
              h('code', { className: 'acp-code' }, POLICY_NAME),
              h('button', { className: 'acp-btn small', onClick: copyPolicy },
                copied ? '已复制' : '复制')),
            h('p', { className: 'acp-note' },
              '该策略只读，无法修改任何资源。也可以用最小权限自定义策略，只授予 ',
              h('code', null, 'bss:DescribeCoupon'),
              ' 和 ',
              h('code', null, 'bss:DescribeAcccount'),
              '。'),
            h('button', { className: 'acp-btn', onClick: () => open(RAM_POLICIES) },
              '打开 RAM 权限策略 ↗'))),

        step('3', '填入 AccessKey',
          h('div', { className: 'acp-step-body' },
            h('label', { className: 'acp-field' },
              h('span', null, 'AccessKey ID'),
              h('div', { className: 'acp-input-row' },
                h('input', {
                  className: 'acp-input',
                  type: show.ak ? 'text' : 'password',
                  placeholder: 'LTAI...',
                  value: form.ak,
                  autoComplete: 'off',
                  spellCheck: false,
                  disabled: busy,
                  onChange: (e) => setForm({ ...form, ak: e.target.value }),
                }),
                h('button', {
                  className: 'acp-btn small',
                  onClick: () => setShow({ ...show, ak: !show.ak }),
                }, show.ak ? '隐藏' : '显示'))),
            h('label', { className: 'acp-field' },
              h('span', null, 'AccessKey Secret'),
              h('div', { className: 'acp-input-row' },
                h('input', {
                  className: 'acp-input',
                  type: show.sk ? 'text' : 'password',
                  placeholder: '创建 AccessKey 时只会显示一次',
                  value: form.sk,
                  autoComplete: 'off',
                  spellCheck: false,
                  disabled: busy,
                  onChange: (e) => setForm({ ...form, sk: e.target.value }),
                }),
                h('button', {
                  className: 'acp-btn small',
                  onClick: () => setShow({ ...show, sk: !show.sk }),
                }, show.sk ? '隐藏' : '显示'))),
            h('div', { className: 'acp-actions' },
              h('button', {
                className: 'acp-btn primary',
                onClick: save,
                disabled: busy || !form.ak.trim() || !form.sk.trim(),
              }, busy ? '处理中…' : '保存并测试'),
              config && config.configured
                ? h('button', { className: 'acp-btn', onClick: test, disabled: busy }, '测试连接')
                : null,
              config && config.configured
                ? h('button', { className: 'acp-btn danger', onClick: clear, disabled: busy }, '清除配置')
                : null))),

        statusNode,

        h('p', { className: 'acp-foot-note' },
          'AccessKey 保存在 DSH 凭据库中，仅用于本地请求签名，不会上传到任何服务器。'))
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
        return h('div', {
          className: 'acp-card acp-setup',
          title: '点击打开设置，配置阿里云 AccessKey',
          onClick: openSettings,
        },
          h('div', { className: 'acp-row' },
            h('span', { className: 'acp-label' }, h('span', { className: 'acp-dot setup' }), '阿里云余额'),
            h('span', { className: 'acp-val setup' }, '未配置 ›')),
          h('div', { className: 'acp-sub' }, '点击前往配置（只需一次性设置）'))
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

      // 侧边栏底部的状态卡片
      const registerCard = () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'aliyun-coupon-api',
        order: 10,
        inject: () => ({}),
      }, Card)
      ctx.slots.inject('sidebar.footer.action', registerCard)

      // 设置页里的凭据配置区块
      const registerSection = () => ctx.slots.register({
        name: 'settings.section',
        id: 'aliyun-coupon',
        order: 40,
        label: '阿里云代金券',
        inject: () => ({}),
      }, SetupSection)
      ctx.slots.inject('settings.section', registerSection)
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
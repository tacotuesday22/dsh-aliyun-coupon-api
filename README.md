# dsh-aliyun-coupon-api

阿里云余额 + 代金券挂件，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。**走官方 OpenAPI，不需要账号密码。**

在侧边栏底部显示：

```
今日  52.0M tokens        ¥1.93
余额                      ¥0.00
代金券                    ¥276.75
面值 ¥300.00 · 1 张 · 355天后到期
```

- **今日消耗**：读取 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的本地账本（未安装则自动隐藏该行）
- **账户余额 / 代金券**：阿里云官方 OpenAPI
- **刷新**：每 5 分钟自动更新一次；点击卡片立即刷新

## 查询的两个接口

| 数据 | 接口 | API 版本 | 权限点 |
|---|---|---|---|
| 账户余额 | `QueryAccountBalance` | **2017-12-14** | `bss:DescribeAcccount` |
| 代金券 | `DescribeCoupon` | **2023-09-30** | `bss:DescribeCoupon` |

> 两者版本号不同但签名算法相同，插件已分别处理。
> 系统策略 `AliyunBSSReadOnlyAccess`（含 `bss:Describe*`）**同时覆盖这两个**，所以挂这一个策略即可。

**关于「账户余额」的口径**：显示的是 `AvailableAmount`（可用额度，含信控等因素），
不等同于现金余额、也不等同于消费额。原始字段里还有 `AvailableCashAmount`（可用现金）。

## 为什么用它而不是抓网页

| | 本插件 | 抓网页类插件 |
|---|---|---|
| 凭据 | RAM **只读** AccessKey | 阿里云账号**明文密码** |
| 访问方式 | 官方 OpenAPI（`DescribeCoupon`） | 模拟登录 + 解析 HTML |
| 合规 | 符合阿里云服务条款 | 违反条款风险 |
| 稳定性 | 接口版本化，页面改版无影响 | 页面一改就失效 |
| 二次验证 | 无关 | 开了就用不了 |

## 快速开始

三步：**① 建 RAM 只读子账号拿到 AccessKey → ② 装插件 → ③ 把 AccessKey 填进 DSH**

下面每步都有详细操作。

> 💡 **推荐用内置配置界面**：安装插件后，侧边栏卡片会显示「未配置 ›」，
> 点击会跳到 **设置 → 阿里云代金券**，那里有三步引导、直达阿里云控制台的按钮，
> 以及 AccessKey 填写表单（保存前会自动验证）。下面的手动步骤仅供参考或备用。

---

## 第一步：获取阿里云 AccessKey（只读权限）

> 全程在 [阿里云 RAM 控制台](https://ram.console.aliyun.com/) 完成，约 3 分钟。
> **不要用主账号的 AccessKey**，务必建子账号。

### 1.1 创建 RAM 用户

打开 <https://ram.console.aliyun.com/users>，点 **创建用户**。

| 字段 | 填什么 |
|---|---|
| 登录名称 | 例如 `dsh-coupon-reader` |
| 显示名称 | 例如 `DSH 只读查询` |
| 访问方式 | ✅ 勾选 **「使用永久 AccessKey 访问」** |
| | ❌ **不要**勾选「使用控制台访问」 |

> 「使用控制台访问」会给这个子账号配登录密码，让它能登进阿里云控制台。
> 插件只需要 API 调用，勾了反而多一个攻击面。

点 **确定**，然后在结果页把 **AccessKey ID** 和 **AccessKey Secret** 复制出来。

> ⚠️ **AccessKey Secret 只显示这一次**，关掉页面就再也看不到了。
> 没存下来的话只能删掉重建。

### 1.2 授予只读权限

创建完用户后，进入该用户 → **权限管理** 标签 → **新增授权**。

**方式 A：直接挂系统策略（最快）**

在「新增授权」面板里：

1. 筛选条件从「自定义策略」切换成 **「系统策略」**
2. 搜索框输入 `AliyunBSSReadOnlyAccess`
3. **勾选** 搜索结果那一行的复选框
4. 点 **确定**

该策略包含 `bss:Describe*` 和 `bssapi:Query*`，同时覆盖余额和代金券两个接口，**只读，改不了任何东西**。

**方式 B：最小权限（更严格）**

只给这两个接口，需要先去建自定义策略：

1. 左侧菜单 **权限策略** → **创建策略**
2. 选 **「脚本编辑」**，把内容替换为：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bss:DescribeCoupon",
        "bss:DescribeAcccount"
      ],
      "Resource": "*"
    }
  ]
}
```

3. 下一步 → 名称填 `DSH-Coupon-ReadOnly` → 确定
4. 回到用户 → 权限管理 → 新增授权 → 筛选「自定义策略」→ 勾选刚建的那个 → 确定

> ⚠️ `bss:DescribeAcccount` 是阿里云官方文档的**原始拼写**（三个 `c`，不是笔误）。
> 若该拼写报错，再补一条 `bss:DescribeAccount`（两个 `c`）。

对应官方文档：
- [DescribeCoupon — 查询优惠券列表](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2023-09-30-describecoupon)
- [QueryAccountBalance — 查询账户余额](https://help.aliyun.com/en/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)

### 1.3 验证 AccessKey 能用（可选但推荐）

先在命令行验证一下，避免装好插件才发现权限没配对。

```bash
export ALIBABA_CLOUD_ACCESS_KEY_ID=LTAI...
export ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
node test-live.mjs
```

输出里能看到券余额和账户余额就说明配置正确。

---

## 第二步：安装插件

### ⚠️ 先搞清楚你的 `dsh` 是哪一个

`dsh plugin --profile desktop` 这个命令，**只有桌面版自带的 CLI 才能操作 desktop profile**。

| 你的 `dsh` 来自 | 能否装进桌面版 |
|---|---|
| **DeepSeek Harness 桌面版自带** | ✅ 可以 |
| `npm i -g @deepseek-ai/dsh` 全局安装 | ❌ 会被拒绝 |

> 官方说明：desktop profile 归 Electron 应用独占，npm 版 CLI 的插件管理请求会被拒绝，
> 需用桌面版安装目录里的 `dsh` 命令操作。这是有意设计，避免不同运行时互相污染。

**桌面版的 `dsh` 通常不在 PATH 里**，需要写完整路径。先确认你的路径：

<details>
<summary>Windows 查找方法</summary>

默认位置：

```
%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
```

可以直接用：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --version
```

如果能打印版本号，就用这个完整路径执行下面所有命令。
</details>

<details>
<summary>macOS / Linux 查找方法</summary>

```bash
# macOS
ls "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/"

# 或者直接在全盘找
find / -name "dsh" -path "*runtime/cli/bin*" 2>/dev/null
```

找到后同样用完整路径执行。
</details>

下面为可读起见简写为 `dsh`，**请替换成你实际可用的那个命令**。

---

### 方式 A：从 GitHub 源码构建后安装（推荐）

```bash
git clone https://github.com/tacotuesday22/dsh-aliyun-coupon-api.git
cd dsh-aliyun-coupon-api
npm install          # prepare 脚本会自动执行 build.mjs，生成 lib/
npm pack             # 生成 dsh-aliyun-coupon-api-<版本>.tgz
```

然后安装（把 `<dsh>` 换成你的完整路径）：

```powershell
# Windows 示例
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add .\dsh-aliyun-coupon-api-<版本>.tgz
```

```bash
# macOS / Linux 示例
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add ./dsh-aliyun-coupon-api-<版本>.tgz
```

> **为什么要 `npm pack` 而不是直接 `add .`**
>
> `dsh plugin add .` 会创建一个指向源码目录的**符号链接**（`link:`）。
> 之后如果你移动或删除该目录，插件就会失效，甚至导致 DSH 无法启动。
> 用 tarball 安装是真实拷贝，安全得多。
>
> `lib/`（构建产物）不在仓库里，必须先构建。手动构建也行：
>
> ```bash
> node build.mjs
> npm pack
> ```

### 方式 B：直接安装 tgz

如果别人已经给你一个 `.tgz`，省掉 clone 与构建：

```powershell
# Windows
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add .\dsh-aliyun-coupon-api-<版本>.tgz
```

```bash
# macOS / Linux
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add ./dsh-aliyun-coupon-api-<版本>.tgz
```

### 方式 C：npm 安装（发布后可用）

同样必须用桌面版自带的 CLI：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add dsh-aliyun-coupon-api
```

### 确认安装成功

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop list
```

输出里应能看到 `dsh-aliyun-coupon-api@<版本>`。

**卸载**：把 `add` 换成 `remove`。

### 安装后必须重启

完全退出 DeepSeek Harness 再重新打开。

> 只刷新页面不够，插件只在启动时加载。

---

## 第三步：填入 AccessKey

三种方式，任选其一。**推荐方式 1**（内置界面，最省事）。

### 方式 1：用内置配置界面（推荐）

1. 重启 DSH 后，侧边栏底部卡片显示：

   ```
   ● 阿里云余额        未配置
     去设置 ›  ·  配置教程 ↗
   ```

2. 点 **去设置 ›** → 自动打开 **设置 → 阿里云代金券** 区块
3. 区块内有三步引导：
   - **① 创建只读子账号** — 按钮直达 RAM 用户控制台
   - **② 授予只读权限** — 显示策略名 `AliyunBSSReadOnlyAccess` 并可一键复制，按钮直达策略页
   - **③ 填入 AccessKey** — 两个输入框（默认掩码，可点「显示」）
4. 点 **保存并测试** — 会先验证再写入，**验证不通过不会保存**

保存成功后：
- 卡片立即恢复正常显示，无需重启
- 设置页会显示「✓ 已配置（AK 末四位 xxxx）」

> 输入框有一层格式校验：如果误把模型 API Key（`sk-` 开头）填进来，
> 会明确提示「你填的看起来是模型 API Key，不是阿里云 RAM AccessKey」。

#### 「去设置」打不开怎么办

DSH 没有公开"打开设置面板"的编程接口，插件只能通过 DOM 查找设置按钮再模拟点击。
不同版本的界面结构可能变化，所以这里做了三层保护：

1. **多选择器依次尝试** — 优先用 `aria-label`、`data-*` 这类稳定属性，
   从不依赖 DSH 生成的哈希化 class 名
2. **结果校验** — 点击后用 `MutationObserver` 确认设置面板真的出现了
   （600ms 超时），没出现就换下一个选择器
3. **静默降级** — 全部失败时不弹窗打断，只在卡片下方显示一行提示：

   ```
   自动打开失败，请手动点击左下角「设置」  报告问题 ↗
   ```

   此时 **请手动点击侧边栏左下角的「设置」按钮**，我们的配置区块会自动滚动到可视区域。

**点「报告问题 ↗」** 会自动打开 GitHub Issue 页面，并**预填好诊断信息**：

- 插件版本、时间、User-Agent
- 每个选择器的尝试结果（找到 / 未找到）
- 侧边栏底部按钮的候选清单（**只有属性与按钮文字，不含页面其他内容**）
- class 名已做去哈希处理

维护者凭这些信息可以直接定位该用哪个选择器，不必来回问。

**关于凭据存放位置**：写入 DSH 凭据服务（`ctx.credentials.set`），
与 DSH 自带的模型 Key 管理机制一致，不会破坏 `.credentials.yaml` 的结构。

**清除配置**：设置页里点「清除配置」，会同时清理凭据服务与
`.credentials.yaml` 中的对应行（其他键不受影响）。
若凭据来自环境变量，界面会提示你需要自行删除环境变量。

> 💡 卡片上的 **配置教程 ↗** 链接直达本 README，方便随时查阅。

### 方式 2：写进 DSH 凭据文件（手动）

编辑 `~/.dsh/.credentials.yaml`（Windows 上是 `C:\Users\<你>\.dsh\.credentials.yaml`），
在 `refs:` 段下加两行：

```yaml
refs:
  # 已有的其他键保留不动
  ALIBABA_CLOUD_ACCESS_KEY_ID: LTAI5t**************
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: **************
```

要点：
- 保持两空格缩进，与已有条目对齐
- 值**不要加引号**（除非含特殊字符）
- 改完**重启 DSH**

### 方式 3：环境变量

```powershell
# Windows（PowerShell）
[Environment]::SetEnvironmentVariable('ALIBABA_CLOUD_ACCESS_KEY_ID', 'LTAI...', 'User')
[Environment]::SetEnvironmentVariable('ALIBABA_CLOUD_ACCESS_KEY_SECRET', '...', 'User')
```

```bash
# macOS / Linux（写进 ~/.zshrc 或 ~/.bashrc）
export ALIBABA_CLOUD_ACCESS_KEY_ID=LTAI...
export ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
```

改完**完全退出并重新打开** DSH（环境变量要对新进程生效）。

### 使用 STS 临时凭据

除上面两项外，再提供：

```
ALIBABA_CLOUD_SECURITY_TOKEN=<your token>
```

### ⚠️ 常见误区

> **这不是千问 / 百炼的模型 API Key**（那种以 `sk-` 开头）。
> 这里是阿里云 **RAM AccessKey**，以 `LTAI` 开头。

插件查找凭据的顺序：`credentials` 服务 → `.credentials.yaml` → 环境变量。
三个都没有时才显示「未配置」。

---

## 使用

重启后侧边栏底部（设置按钮旁）出现卡片：

```
今日  52.0M tokens        ¥1.93
余额                      ¥0.00
代金券                    ¥276.75
面值 ¥300.00 · 1 张 · 355天后到期
```

| 操作 | 效果 |
|---|---|
| 点击卡片 | 立即强制刷新 |
| 等待 | 每 5 分钟自动刷新一次 |

页面隐藏（最小化/切到后台）时暂停轮询，切回来恢复。

### 自检接口

```bash
curl http://127.0.0.1:<端口>/api/aliyun-coupon/diag
```

端口是 DSH 启动时打印的地址里的那个（每次可能不同）。
返回值说明：

| 字段 | 含义 |
|---|---|
| `hasCredentials` | 是否读到 AccessKey |
| `credentialsService` | DSH 凭据服务状态（`ok` / `absent`） |
| `probe` | 在宿主进程内实际调用一次阿里云的结果 |

响应**不含任何密钥**，只报长度。

---

## 故障排除

| 现象 | 原因与处理 |
|---|---|
| 卡片显示「未配置」 | AccessKey 没读到。检查 `.credentials.yaml` 缩进、或环境变量是否生效（需完全重启） |
| 卡片显示「读取失败」 | 试试 `curl .../diag` 看 `probe.error` 的具体报错 |
| `probe` 报 403 / NoPermission | RAM 权限不足，补齐 `bss:DescribeCoupon` 和 `bss:DescribeAcccount` |
| `probe` 报 SignatureDoesNotMatch | Secret 复制错了（注意别带空格）或本机时间不准 |
| 侧边栏没有卡片 | DSH 没重启，或版本低于要求 |
| 只有「今日」没有阿里云数据 | AccessKey 未配置，此时只显示本地消耗 |
| 没有「今日」那行 | 未安装 `dsh-cost-meter`，属正常降级 |

---

## 安全设计

- **只读**：仅调用 `DescribeCoupon` / `QueryAccountBalance`，没有任何写操作
- **凭证不外泄**：AccessKey 只在宿主端用于本地签名，永不回传浏览器
- **不跟随重定向**：`redirect: 'manual'`，防止凭据被转发到其他主机
- **固定端点**：只发 POST 到 `https://business.aliyuncs.com/`，代码中不存在其他外部地址
- **鉴权 fail-closed**：路由复用 DSH `connection` 服务；该服务缺失时**拒绝访问**而非放行
- **错误不外泄**：阿里云原始错误体不直接返回前端，避免泄露账户标识
- **最小权限**：只需 RAM 只读策略，泄露后也无法修改任何资源

> ⚠️ 凭据文件 `.credentials.yaml` 是**明文 YAML**，靠文件系统权限保护。
> 建议始终使用只读子账号的 AccessKey，不要用主账号。

---

## 关于「云工开物」学生券

本插件读取的是阿里云 BSS 的**代金券列表**（`DescribeCoupon`），返回字段包括
面值 `Amount`、剩余 `RemainAmount`、状态、有效期、适用范围等。

插件只统计**状态可用且未过期**的券；已过期、已用完、冻结状态的不计入可用余额。

「账户余额」显示的是 `AvailableAmount`（可用额度，含信控等因素），
**不等同于现金余额**，也不等同于消费额。原始字段里还有 `AvailableCashAmount`（可用现金）。

---

## 与「抓网页」类插件的区别

市面上有些同类插件靠模拟登录控制台抓 HTML，本插件走官方 API：

| | 本插件 | 抓网页类插件 |
|---|---|---|
| 凭据 | RAM **只读** AccessKey | 阿里云账号**明文密码** |
| 访问方式 | 官方 OpenAPI | 模拟登录 + 解析 HTML |
| 合规 | 符合阿里云服务条款 | 违反条款风险 |
| 稳定性 | 接口版本化，页面改版无影响 | 页面一改就失效 |
| 二次验证 | 无关 | 开了就用不了 |

## 开发

仓库里只有源码（`src/`），`lib/` 是构建产物，**不提交到 git**。

```bash
# 构建
npm run build          # 等价于 node build.mjs，生成 lib/ 并校验客户端模块格式

# 打包分发
npm pack               # 生成 dsh-aliyun-coupon-api-x.y.z.tgz

# 安装到本地 profile
dsh plugin --profile desktop add ./dsh-aliyun-coupon-api-x.y.z.tgz
```

> **为什么 `lib/` 不入库**：它是 `src/` 的机械转换结果，提交会让 diff 变得难读。
> `prepare` 脚本保证 `npm install` / git 安装时自动构建。
>
> 但注意：**直接 `dsh plugin add <仓库目录>` 而不先构建会失败**，
> 因为 `main` 指向 `./lib/index.js`。请先 `npm run build`。

### 目录结构

```
src/
├─ index.js     宿主端插件（路由、凭据、缓存）
├─ aliyun.js    阿里云 API 签名与响应归一化
├─ usage.js     今日消耗（读 dsh-cost-meter 账本）
└─ client.js    浏览器端挂件（__ModuleLoader__ 格式）
lib/            构建产物（git 忽略）
*.mjs           测试脚本
build.mjs       src/ → lib/ 的构建脚本
```

### 测试

不需要网络的：

```bash
npm test               # 运行 logic + usage + inject + client + real
```

需要本机已配置 AccessKey 的：

```bash
node test-live.mjs     # 真实调用阿里云两个接口
node test-e2e.mjs      # 完整 host 端链路
```

逐个说明：

```bash
node test-logic.mjs    # 签名与响应归一化（无需网络）
node test-usage.mjs    # 今日消耗读取
node test-host.mjs     # 主机端路由与鉴权
node test-inject.mjs   # Cordis 注入时序（包括"依赖尚未就绪"的场景）
node test-client.mjs   # 客户端模块格式与插槽注册
node test-creds.mjs    # 凭据三级回落（需本机已配置 AccessKey）
node test-real.mjs     # 真实响应的回归用例（无需网络）
node test-e2e.mjs      # 端到端（需本机已配置 AccessKey，会真实调用阿里云）
```

需要凭据的测试默认读取 `$DSH_HOME/.credentials.yaml`（`DSH_HOME` 缺省为 `~/.dsh`），
也可用环境变量 `DSH_CREDENTIALS_FILE` 指定路径。

### 踩过的坑

1. **Cordis 服务必须用 `ctx.inject` 注入，不能直接 `ctx.get`**
   服务是**异步就绪**的。在 `apply()` 里直接 `ctx.get('webServer')` 时它往往还没注册完，
   拿到 `undefined`，路由会**静默注册失败**——前端请求打过来只是 404/无响应。
   正确写法：

   ```js
   ctx.inject(['webServer'], (scope) => {
     const dispose = (scope.webServer || scope.get('webServer'))
       .register({ kind: 'prefix', path: API_PREFIX, handler })
     scope.effect(() => () => dispose(), 'xxx: routes')
   })
   ```

2. **客户端模块格式**：DSH 0.2.1-rc.5 起客户端插件必须是
   `window.__ModuleLoader__.load({ id, factory })`，写成裸 `module.exports`
   会报 `module is not defined` 并导致整个 web boot 失败。`build.mjs` 已加格式校验。

3. **`DescribeCoupon` 的 `Status` 参数区分大小写**：接口实际返回 `AVAILABLE`（全大写），
   而文档示例写的是 `Available`。传错大小写时**静默返回空数组**，不报错。
   本插件因此不使用服务端状态过滤，改为拉全量后本地判断。

4. **金额精度**：`RemainAmount` 可能返回 10 位小数（如 `282.9609674126`），展示时统一保留两位。

5. **两个接口的 API 版本不同**：`DescribeCoupon` 是 `2023-09-30`，
   `QueryAccountBalance` 是 `2017-12-14`，`x-acs-version` 必须分别设置。

6. **凭据不要只押在 `credentials` 服务上**：该服务的可用性随 DSH 版本变化。
   本插件做三级回落：`credentials` 服务 → `$DSH_HOME/.credentials.yaml` → 环境变量。

## 许可

MIT
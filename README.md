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
- **刷新**：分两档 —— 今日消耗每 **30 秒** 更新一次（读本地账本，无网络开销）；
  阿里云余额与代金券每 **5 分钟** 更新一次（避免频繁调用 API）。点击卡片可立即强制刷新两者

---

## 目录

- [两种安装方式](#两种安装方式)
- [完整教程](#完整教程) — 从零到能用，分四步
- [使用](#使用)
- [故障排除](#故障排除)
- [技术说明](#技术说明) — 调用了哪些接口、与抓网页方案的对比
- [安全设计](#安全设计)
- [开发](#开发)

---

## 两种安装方式

### 方式一：手动安装（按教程一步步来）

适合想弄清楚每一步在做什么的用户。照下面的 [完整教程](#完整教程) 走即可，约 10 分钟。

### 方式二：让 AI Agent 帮你装（推荐给新手）

如果你正在用 DeepSeek Harness 本身的 Agent，或者 Claude Code / Cursor 之类能执行命令的 AI 工具，
可以**把下面这段话直接发给它**，它会自动完成安装与配置：

````text
请帮我安装并配置 DSH 插件 dsh-aliyun-coupon-api。

背景信息：
- 这是一个 DeepSeek Harness 插件，通过阿里云官方 OpenAPI 只读查询
  账户余额与代金券余额，显示在侧边栏底部。
- 仓库：https://github.com/tacotuesday22/dsh-aliyun-coupon-api
- 详细文档见该仓库 README。

请按以下步骤操作：

1. 先确认我能用的 dsh 命令：
   - 桌面版的 dsh 通常在
     %LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
     （macOS 在 /Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh）
   - 注意：npm 全局安装的 dsh 无法操作 desktop profile，必须用桌面版自带的。

2. 克隆仓库并构建：
   git clone https://github.com/tacotuesday22/dsh-aliyun-coupon-api.git
   cd dsh-aliyun-coupon-api
   npm install     # prepare 会自动生成 lib/
   npm pack        # 生成 tgz

3. 用桌面版 dsh 安装 tgz：
   <dsh> plugin --profile desktop add ./dsh-aliyun-coupon-api-*.tgz
   然后用 <dsh> plugin --profile desktop list 确认已出现该插件。

4. 提醒我重启 DeepSeek Harness。

5. 重启后，请引导我完成阿里云 AccessKey 配置：
   - 告诉我需要去 https://ram.console.aliyun.com/users 创建一个子用户
   - 勾选「使用永久 AccessKey 访问」，不要勾「使用控制台访问」
   - 授予系统策略 AliyunBSSReadOnlyAccess（只读，无法修改任何资源）
   - 创建 AccessKey 后，把 ID 和 Secret 填进插件设置页
     （设置 → 阿里云代金券，保存前会自动验证）
   - 强调：这是 RAM AccessKey（LTAI 开头），不是模型 API Key（sk- 开头）

如果任何一步失败，请告诉我具体报错，不要跳过。
````

> **为什么推荐这个方式**：安装环节涉及路径查找、构建、CLI 调用，对不熟悉命令行的用户是门槛。
> Agent 可以直接读取报错并调整，你说一句话就能完成。
>
> ⚠️ 注意：**AccessKey 的创建必须在阿里云控制台由你本人操作**，不要把它贴给 AI。
> 配好之后填进插件设置页即可，插件会自己保存。

---

## 完整教程

四步：**① 建只读子账号 → ② 装插件 → ③ 填 AccessKey → ④ 验证**

整个过程约 10 分钟。

> 💡 **推荐用内置配置界面**：安装插件后，侧边栏卡片会显示「未配置」，
> 点「去设置 ›」会打开 **设置 → 阿里云代金券**，那里有三步引导、
> 直达阿里云控制台的按钮，以及 AccessKey 填写表单（保存前会自动验证）。
> 下面的手动步骤仅供参考或备用。

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
npm run test:live
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
npm install          # prepare 脚本会自动生成 lib/
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
> npm run build
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

### 第四步：验证配置是否生效

配置成功后卡片会**自动刷新**，无需重启。看到真实数字就说明成功了。

想更确定一点，可以跑一次自检（端口是 DSH 启动时打印的地址里的那个）：

```bash
curl http://127.0.0.1:<端口>/api/aliyun-coupon/diag
```

重点看这几个字段：

| 字段 | 期望值 | 含义 |
|---|---|---|
| `hasCredentials` | `true` | 凭据读到了 |
| `probe.ok` | `true` | 在宿主进程内成功调用了阿里云 |
| `probe.count` | 你的券数量 | 读到的可用券数 |
| `source` | `store` / `file` / `env` | 凭据来自哪里 |

响应**不含任何密钥**，只报长度，可以放心分享到 Issue 里排错。

如果 `probe.ok` 为 `false`，看 `probe.error` 的具体内容，对照下面的 [故障排除](#故障排除)。

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
| 点击卡片 | 立即强制刷新（今日消耗与阿里云数据都重新拉取） |
| 等待 30 秒 | 「今日」消耗数字更新（读本地账本，不产生网络请求） |
| 等待 5 分钟 | 余额与代金券更新（宿主端缓存到期，才会真正调用阿里云 API） |

**为什么是两档频率**：今日消耗来自本地账本，读取成本几乎为零，所以刷新得勤；
阿里云接口有调用频率限制，且余额/代金券不会秒级变化，所以缓存 5 分钟。

> 点击卡片强制刷新有 30 秒最小间隔，避免误触连续打满阿里云 API。

页面隐藏（最小化 / 切到后台）时暂停轮询，切回来立即恢复。

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

## 技术说明

### 调用的两个接口

| 数据 | 接口 | API 版本 | 权限点 |
|---|---|---|---|
| 账户余额 | `QueryAccountBalance` | **2017-12-14** | `bss:DescribeAcccount` |
| 代金券 | `DescribeCoupon` | **2023-09-30** | `bss:DescribeCoupon` |

> 两者版本号不同但签名算法相同（ACS3-HMAC-SHA256），插件已分别处理。
> 系统策略 `AliyunBSSReadOnlyAccess`（含 `bss:Describe*` 与 `bssapi:Query*`）
> **同时覆盖这两个**，所以挂这一个策略即可。

**关于「账户余额」的口径**：显示的是 `AvailableAmount`（可用额度，含信控等因素），
**不等同于现金余额**，也不等同于消费额。原始字段里还有 `AvailableCashAmount`（可用现金）。

### 为什么用它而不是抓网页

| | 本插件 | 抓网页类插件 |
|---|---|---|
| 凭据 | RAM **只读** AccessKey | 阿里云账号**明文密码** |
| 访问方式 | 官方 OpenAPI | 模拟登录 + 解析 HTML |
| 合规 | 符合阿里云服务条款 | 违反条款风险 |
| 稳定性 | 接口版本化，页面改版无影响 | 页面一改就失效 |
| 二次验证 | 无关 | 开了就用不了 |

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

### 仓库里为什么没有 `lib/`

`lib/` 是 `src/` 的机械转换产物，提交它会让 diff 变得难读，所以由 `.gitignore` 排除。

**但这意味着克隆后必须先构建，否则插件无法运行** ——
`package.json` 的 `main` 指向 `./lib/index.js`，文件不存在时插件加载会失败。

| 你的操作 | 是否自动构建 |
|---|---|
| `npm install` | ✅ 会（触发 `prepare` 脚本） |
| `npm pack` | ✅ 会（触发 `prepare` 脚本） |
| `npm publish` | ✅ 会（触发 `prepublishOnly`） |
| **直接 `dsh plugin add <源码目录>`** | ❌ **不会**，必须先 `npm run build` |

所以推荐流程始终是：

```bash
npm install    # 自动生成 lib/
npm pack       # 打包成含 lib/ 的 tgz
<dsh> plugin --profile desktop add ./dsh-aliyun-coupon-api-<版本>.tgz
```

> 如果你确实想直接从目录安装，请先执行 `npm run build`，
> 否则装上去的是一个指向空 `lib/` 的链接，插件不会生效。

---

## 关于「云工开物」学生券

本插件读取的是阿里云 BSS 的**代金券列表**（`DescribeCoupon`），返回字段包括
面值 `Amount`、剩余 `RemainAmount`、状态、有效期、适用范围等。

插件只统计**状态可用且未过期**的券；已过期、已用完、冻结状态的不计入可用余额。

「账户余额」显示的是 `AvailableAmount`（可用额度，含信控等因素），
**不等同于现金余额**，也不等同于消费额。原始字段里还有 `AvailableCashAmount`（可用现金）。

---

## 开发

仓库里只有源码，`lib/` 是构建产物，**不提交到 git**。

```bash
npm run build          # src/ → lib/，并校验客户端模块格式
npm pack               # 打包成 dsh-aliyun-coupon-api-<版本>.tgz
npm test               # 单测 + 集成测试（无需网络与凭据）
npm run verify         # 校验已安装到 profile 里的副本
```

> **为什么 `lib/` 不入库**：它是 `src/` 的机械转换结果，提交会让 diff 变得难读。
> `prepare` / `prepublishOnly` 脚本保证 `npm install`、`npm pack`、`npm publish` 时自动构建。

### 目录结构

```
src/                     源码
├─ index.js              宿主端插件：路由、凭据读取、缓存、配置接口
├─ aliyun.js             阿里云 OpenAPI 签名（ACS3-HMAC-SHA256）与响应归一化
├─ usage.js              今日消耗：读 dsh-cost-meter 的本地账本
└─ client.js             浏览器端：侧边栏卡片 + 设置页配置区块

scripts/                 工具脚本
├─ build.mjs             src/ → lib/ 构建，并校验客户端模块格式
└─ verify-installed.mjs  加载 profile 中已安装的副本，模拟 DSH 客户端加载器

tests/
├─ unit/                 单元测试（纯逻辑，无需网络与凭据）
│  ├─ signing.mjs        签名算法与错误处理
│  ├─ normalize.mjs      真实响应的归一化回归
│  ├─ usage.mjs          今日消耗读取与边界情况
│  ├─ inject.mjs         Cordis 注入时序（含依赖未就绪场景）
│  ├─ client-module.mjs  客户端模块格式与插槽注册
│  ├─ settings-open.mjs  「去设置」自动打开与失败诊断
│  └─ readme.mjs         README 事实校验（命令、路径、锚点、版本号）
├─ integration/          集成测试（需先 build）
│  ├─ host-routes.mjs    路由注册、鉴权 fail-closed、diag 不泄露密钥
│  ├─ config-api.mjs     凭据配置接口全流程
│  └─ cache-freshness.mjs 缓存命中时今日消耗仍需实时
└─ manual/               手动测试（需本机已配置真实 AccessKey）
   ├─ live-api.mjs       真实调用阿里云两个接口
   ├─ e2e.mjs            完整 host 端链路
   ├─ creds-fallback.mjs 凭据三级回落
   └─ inspect-fields.mjs 打印真实响应字段，排查归一化

cordis.patch.yml         插件注册（bundle patch）
package.json             含 dsh.bundle / dsh.client 声明
lib/                     构建产物（git 忽略）
```

### 测试

```bash
npm test                 # 全部单元 + 集成测试，无需网络与凭据
npm run test:unit        # 仅单元测试
npm run test:integration # 仅集成测试（需先 npm run build）
npm run verify           # 校验已安装副本
```

需要真实凭据的手动测试（**会产生阿里云 API 调用**）：

```bash
npm run test:live                  # 真实调用 DescribeCoupon / QueryAccountBalance
node tests/manual/e2e.mjs          # 完整链路
node tests/manual/creds-fallback.mjs  # 凭据读取回落
node tests/manual/inspect-fields.mjs  # 打印真实字段
```

> 这些手动测试会读取 `~/.dsh/.credentials.yaml` 中的凭据，
> 输出**不含**密钥本身，只报长度与调用结果。

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
   会报 `module is not defined` 并导致整个 web boot 失败。`scripts/build.mjs` 已加格式校验。

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
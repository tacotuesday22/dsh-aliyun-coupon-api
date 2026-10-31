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

## 前置条件：一个只读的 AccessKey

在阿里云控制台准备一个 **RAM 子账号**及其 AccessKey。

### 1. 创建 RAM 用户

控制台 → **RAM 访问控制** → 用户 → 创建用户

- ✅ 勾选「使用永久 AccessKey 访问」
- ❌ **不要**勾选「使用控制台访问」（不给登录密码，权限更小）

### 2. 授予权限

**最快方式**：直接挂系统策略 **`AliyunBSSReadOnlyAccess`**。
它包含 `bss:Describe*` 和 `bssapi:Query*`，同时覆盖余额和代金券两个接口，只读、改不了任何东西。

**最小权限方式**（更严格，只给这两个接口）：

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

> ⚠️ `bss:DescribeAcccount` 是阿里云官方文档的**原始拼写**（三个 c，不是笔误）。
> 若该拼写报错，再补一条 `bss:DescribeAccount`（两个 c）。

> 文档：
> - [DescribeCoupon](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2023-09-30-describecoupon)
> - [QueryAccountBalance](https://help.aliyun.com/en/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)

### 3. 创建 AccessKey

为该子账号创建 AccessKey，记下 **AccessKey ID** 和 **AccessKey Secret**。

> ⚠️ Secret 只在创建时显示一次，关掉就看不到了。

### 4. 填入 DSH

插件按以下顺序查找凭据：

1. DSH `credentials` 服务（推荐）
2. 环境变量 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
3. 若使用 STS 临时凭据，额外提供 `ALIBABA_CLOUD_SECURITY_TOKEN`

注意：**这不是千问 / 百炼的模型 API Key**，是 RAM AccessKey。

## 安装

```powershell
dsh plugin --profile desktop add <本目录或打包后的 .tgz>
```

装完**重启 DeepSeek Harness**。

## 使用

重启后侧边栏底部（设置按钮旁）出现「代金券余额」卡片：

- **点击** → 立即强制刷新
- 平时每 5 分钟自动刷新一次（宿主侧另有 60 秒缓存、30 秒最小刷新间隔）
- 读取失败时保留上一次成功读数，并标注「缓存值」

### 自检

```powershell
curl -H "Host: 127.0.0.1" http://127.0.0.1:<端口>/api/aliyun-coupon/diag
```

返回值中的 `hasCredentials` 表示凭据是否读到；响应**不含任何密钥**。

## 安全设计

- **只读**：仅调用 `DescribeCoupon`，没有任何写操作
- **凭证不外泄**：AccessKey 只在宿主端用于本地签名，永不回传浏览器
- **不跟随重定向**：`redirect: 'manual'`，防止凭据被转发到其他主机
- **固定端点**：只发 POST 到 `https://business.aliyuncs.com/`，代码中不存在其他外部地址
- **鉴权 fail-closed**：路由复用 DSH `connection` 服务；该服务缺失时**拒绝访问**而非放行
- **错误不外泄**：阿里云原始错误体不直接返回前端，避免泄露账户标识

## 关于「云工开物」学生券

本插件读取的是阿里云 BSS 的**代金券列表**（`DescribeCoupon`），返回字段包括面值 `Amount`、剩余 `RemainAmount`、状态、有效期、适用范围等。

插件只统计**状态可用且未过期**的券；已过期、已用完、冻结状态的不计入可用余额。

## 排错

| 现象 | 处理 |
|---|---|
| 显示「未配置」 | 检查 AccessKey 是否填入 `credentials` 服务或环境变量 |
| 显示「读取失败」/ 鉴权错误 | 检查 AK 是否正确、RAM 是否授予 `bss:DescribeCoupon` |
| 显示「无权限」 | 该接口返回 `Forbidden`，补齐权限后重启 |
| 侧边栏没有卡片 | 确认 DSH 已重启；该插件依赖 `sidebar.footer.action` 插槽 |

## 开发

源码在 `src/`，`lib/` 是构建产物（`.gitignore` 已排除，但打包时需要）。

```bash
node build.mjs        # src/ → lib/，并校验客户端模块格式
npm pack              # 生成 .tgz
dsh plugin --profile desktop add ./dsh-aliyun-coupon-api-x.y.z.tgz
```

### 测试

```bash
node test-logic.mjs    # 签名与响应归一化（无需网络）
node test-usage.mjs    # 今日消耗读取
node test-host.mjs     # 主机端路由与鉴权
node test-client.mjs   # 客户端模块格式与插槽注册
node test-creds.mjs    # 凭据三级回落（需本机已配置 AccessKey）
node test-real.mjs     # 真实响应的回归用例（无需网络）
node test-e2e.mjs      # 端到端（需本机已配置 AccessKey，会真实调用阿里云）
```

需要凭据的测试默认读取 `$DSH_HOME/.credentials.yaml`（`DSH_HOME` 缺省为 `~/.dsh`），
也可用环境变量 `DSH_CREDENTIALS_FILE` 指定路径。

### 踩过的坑

1. **客户端模块格式**：DSH 0.2.1-rc.5 起客户端插件必须是
   `window.__ModuleLoader__.load({ id, factory })`，写成裸 `module.exports`
   会报 `module is not defined` 并导致整个 web boot 失败。`build.mjs` 已加格式校验。

2. **`DescribeCoupon` 的 `Status` 参数区分大小写**：接口实际返回 `AVAILABLE`（全大写），
   而文档示例写的是 `Available`。传错大小写时**静默返回空数组**，不报错。
   本插件因此不使用服务端状态过滤，改为拉全量后本地判断。

3. **金额精度**：`RemainAmount` 可能返回 10 位小数（如 `282.9609674126`），展示时统一保留两位。

4. **两个接口的 API 版本不同**：`DescribeCoupon` 是 `2023-09-30`，
   `QueryAccountBalance` 是 `2017-12-14`，`x-acs-version` 必须分别设置。

## 许可

MIT
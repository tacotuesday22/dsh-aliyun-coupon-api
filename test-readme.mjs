// 校验 README 中的关键事实：路径、命令、链接是否真实有效。
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const readme = fs.readFileSync('D:/Users/Ryan/Documents/PaperNotes/DSH/dsh-aliyun-coupon-api/README.md', 'utf8')
const pkg = JSON.parse(fs.readFileSync('D:/Users/Ryan/Documents/PaperNotes/DSH/dsh-aliyun-coupon-api/package.json', 'utf8'))

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✓ ' + l) } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')) } }

console.log('=== 1. 章节结构 ===')
const sections = [...readme.matchAll(/^## (.+)$/gm)].map(m => m[1])
ok(sections[0] === '目录', '目录在第一位', sections[0])
ok(sections.includes('两种安装方式'), '包含「两种安装方式」')
ok(sections.includes('完整教程'), '包含「完整教程」')
const tutorialIdx = sections.indexOf('完整教程')
const usageIdx = sections.indexOf('使用')
ok(tutorialIdx < usageIdx, '教程在「使用」之前（教程前置）', `${tutorialIdx} < ${usageIdx}`)

console.log('\n=== 2. 四步教程齐全 ===')
for (const s of ['第一步：获取阿里云 AccessKey', '第二步：安装插件', '第三步：填入 AccessKey', '第四步：验证配置是否生效']) {
  ok(sections.some(x => x.startsWith(s)) || readme.includes('### ' + s), `有「${s}」`)
}

console.log('\n=== 3. Agent 搭建方式 ===')
ok(/方式二.*AI Agent/s.test(readme), '有 Agent 安装方式')
ok(/请帮我安装并配置 DSH 插件/.test(readme), '含可直接复制的提示词')
ok(/不要把它贴给 AI/.test(readme), '提示词里提醒不要泄露 AccessKey')

console.log('\n=== 4. 关键事实核对 ===')
ok(/AliyunBSSReadOnlyAccess/.test(readme), '策略名正确')
ok(/bss:DescribeCoupon/.test(readme), '权限点 DescribeCoupon')
ok(/bss:DescribeAcccount/.test(readme), '权限点 DescribeAcccount（三 c 拼写）')
ok(/LTAI/.test(readme), '强调 LTAI 前缀')
ok(/sk-/.test(readme), '提醒排除 sk- 前缀')
ok(/resources\\runtime\\cli\\bin\\dsh\.cmd/.test(readme), 'Windows CLI 路径')
ok(/DeepSeek Harness\.app\/Contents\/Resources\/runtime\/cli\/bin\/dsh/.test(readme), 'macOS CLI 路径')
ok(/npm 全局安装的 dsh 无法操作 desktop profile/.test(readme) || /npm.*无法操作 desktop profile/.test(readme),
  '说明 npm CLI 的限制')

console.log('\n=== 5. 版本号一致性 ===')
const versionMentions = [...readme.matchAll(/dsh-aliyun-coupon-api-(\d+\.\d+\.\d+)\.tgz/g)].map(m => m[1])
if (versionMentions.length) {
  ok(versionMentions.every(v => v === pkg.version), 'README 硬编码版本与 package.json 一致',
    `${versionMentions.join(',')} vs ${pkg.version}`)
} else {
  ok(true, '无硬编码版本号（使用 <版本> 占位）')
}

console.log('\n=== 6. 锚点有效性 ===')
const anchors = [...new Set([...readme.matchAll(/\]\(#([^)]+)\)/g)].map(m => m[1]))]
const headerSlugs = [...readme.matchAll(/^#{1,4} (.+)$/gm)].map(m =>
  m[1].replace(/[^\w\u4e00-\u9fa5 \-]/g, '').replace(/ /g, '-').toLowerCase())
for (const a of anchors) {
  ok(headerSlugs.includes(a), `锚点 #${a} 有效`)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
# P0-CONVERGE-002 — 报价 PIT 表述修正与双公司个人阅读结论

**冻结父提交 / 目标基线 SHA**：`9d8600c6bf4f9d820b469891f870d0671f14c958`\
**工作分支**：`codex/company-research-p0-01-06`\
**最高交付状态**：`P0-CONVERGE-002 READY_FOR_ARCHITECTURE_REVIEW`\
**个人研究结论**：`P0_READONLY_RESEARCH_CANDIDATE_WITH_GAPS`；`P0-19 NOT_ACCEPTED`；原运行仍为 `17/19 BLOCKED`

## 实施与 PIT 限制

只修改估值章节报价消费和摘要表述。`dailyCloseAvailableAt(priceDate)` 表示交易所收盘数据理论可用时间；它不证明当前响应已在研究截点前取得。历史 `HISTORICAL` 模式现要求报价 `retrievedAt` 为有效带时区时间且不晚于 `asOf`，否则发出 `VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF`，估值章节保留缺口，报价不进入合格来源集合，参考 PE 和条件 PE 敏感性均不计算。上游 `quality.pointInTimeSafe`、时间戳和数据来源不被改写。

`CURRENT_VALUE_ONLY` 保留符合现有交易日、收盘时点、来源和 resolver gate 的当前参考报价，包括研究开始后才收盘并在响应取得前已收盘的情形。它明确分别显示理论收盘可用时间、实际 `retrievedAt` 和研究起点 `asOf`；摘要标为 `CURRENT_REFERENCE_ONLY` 并保留上游状态为独立字段，正文说明它不是历史数值版本证明或历史 PIT 确认。行情仍只产生当前参考 PE，不变成目标价或独立市场预期面。缺失/非法 `asOf` 或 `retrievedAt`、晚于截点的历史响应、收盘尚不可用和未来价格日均 fail closed。

两个旧归档未更改。其 valuation 报价和派生参考 PE **不具备已证历史版本资格**；报告中原有 `PIT=safe` 是上游状态，不能用作历史版本证明。实际取回比各自 `asOf` 晚：BYD `+3.324s`（`20:19:59.628Z` → `20:20:02.952Z`），东山精密 `+3.257s`（`20:26:46.347Z` → `20:26:49.604Z`）。两者交易日均为 `2026-10-27`，理论收盘可用时间 `07:00:00Z`，对应归档显示的参考价格分别为 82.01 和 101.09 CNY/share；该日收盘早已发生不改变晚取回事实。旧 PE 不得用于历史 as-of 估值结论。

## 两公司个人阅读核对

只读回看既有报告 JSON 中的投资结论、经营驱动、风险、跟踪清单和估值章节；不重做全报告审核。定位以归档报告的 section `evidenceLocations` 为准。BYD run `82bcc425-d48d-4e55-bc45-111aa8c28ba4`，东山精密 run `860916a8-4958-4d29-8da1-56ad5dd1c2c6`。以下六行各覆盖两家公司一项，不代表新增质量验证。

| 阅读项 | BYD 002594 | 东山精密 002384 |
|---|---|---|
| 核心经营判断 | 电池/电子制造积累支撑新能源车及智能化等多业务拓展，协同与资本回报未证实；`investment-thesis`: `official-c19c34dd239b2e9c@paragraph:198,3251,167` | 制造与多产品向 AI 基础设施器件延伸，价值取决于高端 PCB、光模块和收购整合能否形成稳定交付与现金回报；`investment-thesis`: `official-39e591fa149e4543@paragraph:821,816`; `official-296fff2b2889c26f@paragraph:584,585` |
| 关键正面驱动 | 公司披露闪充/储能协同、整车智能化及服务器出货/液冷冷板量产爬坡；不能据此推定技术领先或持续盈利；`investment-thesis`: `official-c19c34dd239b2e9c@paragraph:164,166,342,347,561` | EML 芯片及较高规格芯片进入量产等商业化进展；光模块产品分类毛利率不等于整体毛利率；`investment-thesis`: `official-296fff2b2889c26f@paragraph:359,360,362`; `official-39e591fa149e4543@paragraph:885,886,887,888,889,890,891` |
| 最强反证/风险 | 半年汽车相关产品收入同比下降 8.98%，结构化营业利润/净利润下降而经营现金流增加；客户匿名限制业务映射；`risks`: `official-c19c34dd239b2e9c@paragraph:707,708,706,693,692,691`; `akshare-financial-002594@paragraph:1` | 客户集中：前五大 64.33%、最大客户 46.46%；静态占比不是损失额，商誉和现金转化仍需跟踪；`risks`: `official-39e591fa149e4543@paragraph:937,939,965,969,968,970` |
| 已有跟踪指标/触发 | 分产品收入、利润、经营现金/资本开支、应收及存货、客户占比；收入承压/利润走弱/余额相对收入背离为复核触发，精确量化阈值 `NOT_ESTABLISHED`；`monitoring-checklist`: `official-c19c34dd239b2e9c@paragraph:707,708,762`; `akshare-financial-002594@paragraph:1` | 客户占比与订单、应收回款、分产品收入/占比、光模块分类毛利率、经营现金/资本开支；占比上升或产品走弱触发复核，精确量化阈值 `NOT_ESTABLISHED`；`monitoring-checklist`: `official-39e591fa149e4543@paragraph:862,863,864,866,873,874,875,876,877,885,886,887,888,889,890,891,965,968,969,970` |
| 估值/PIT 限制 | 旧文列 82.01 / FY2025 EPS 3.58 / PE 22.91；报价 `retrievedAt` 晚于 `asOf` 3.324 秒，历史版本资格 `UNVERIFIED`，该 PE 仅是旧报告展示值，不作历史估值；`valuation`: `company-valuation-market-002594-2026-10-27@paragraph:1`; `official-f7c8d23d2829a5e8@paragraph:231` | 旧文列 101.09 / FY2025 EPS 0.79 / PE 127.96；报价 `retrievedAt` 晚于 `asOf` 3.257 秒，历史版本资格 `UNVERIFIED`，该 PE 仅是旧报告展示值，不作历史估值；`valuation`: `company-valuation-market-002384-2026-10-27@paragraph:1`; `official-39e591fa149e4543@paragraph:233` |
| 个人研究可读性 | **可作为只读研究候选并辅助提出下一轮问题**；含经营分析、反证与跟踪项，但 17/19，情景与预期差失败；不构成买卖建议或前瞻预测 | **可作为只读研究候选并辅助提出下一轮问题**；含经营分析、集中度风险与跟踪项，但 17/19，情景与预期差失败；不构成买卖建议或前瞻预测 |

## 六组核心反例与验证

| 反例 | 结果 |
|---|---|
| HISTORICAL：报价在 `asOf` 后 3.324 秒取得（BYD 截面） | `VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF`；估值和来源引用被拒绝 |
| HISTORICAL：报价在 `asOf` 后 3.257 秒取得（东山截面） | 同上；不得以 `pointInTimeSafe=true` 覆盖晚取回事实 |
| CURRENT_VALUE_ONLY：响应晚于研究起点；含研究起点在收盘前、收盘后才取回 | 保留当前参考 PE，明确理论收盘可用时间、响应时间和 `historicalVersion=UNVERIFIED` |
| 截止前已收盘且响应在历史 `asOf` 前取得 | 历史消费正例通过；同日收盘尚不可用的既有负例仍拒绝 |
| 报价日期晚于截面日期 | fail closed；不进入估值来源 |
| `asOf` / `retrievedAt` 缺失或非法，及历史晚取回报价参与情景 | 返回诊断；历史报价不进入 PE 或条件敏感性来源 |

实际命令和退出码：

| 命令 | 退出码 |
|---|---:|
| `node --import tsx --test tests/workflows/company-valuation-sections.test.ts` | 0（22/22） |
| `node --import tsx --test tests/app/services/research-report.test.ts` | 0（17/17） |
| `npm run typecheck -- --pretty false` | 0（`tsc --noEmit`） |
| `git diff --check` | 0（有受保护既存文件的 LF/CRLF 提示，无空白错误） |

全量 Node/Client 回归 `NOT_RUN`；历史基线 21 Node / 5 Client 失败未因本任务改变。未运行真实模型、新 T1、Provider 或 Reviewer；没有 Knowledge 写入、旧报告写入或 schema 变更。没有新增费用。本地真实新 asOf 运行仍需用户批准截面规则与调用预算；本次不请求运行授权。

## 变更文件与受保护文件哈希

目标文件仅为以下三项：

- `workflows/company-deep-research/valuation-sections.ts`
- `tests/workflows/company-valuation-sections.test.ts`
- `docs/engineering/reports/2026-10-29-company-research-p0-converge-002.md`

以下哈希在实施前采集；最终提交前逐一复核，预期前后完全相同。既存用户 JSON、历史归档、日志和临时资料均未暂存或修改。

| 受保护文件 | SHA-256（前 = 后） |
|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252FD35DEC70403FD6BB8B3EDC6FFADD25211FD158461A1DDE30458BF07F442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `EF0E7475E0464CA1E3950FEB348B0D3ED6DC7383E32200FAA3FC413207BC641A` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12C951BE5CA88FB35B155187055B0A15A50D212133C9B68088C0D1674500C0FA` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61CD5CF5B24A7F0FC10746E0269A845D6E29464614C43738D7585EC075FB4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4C02302A5B31CEC6D93B9298E06A76BD0B834B4BACC914670C7FD06AA6300038` |
| `runtime-data/.../002384-analysis.json` | `72588193FAFF4C2E75FB2E07C0B07197619B8C23B9FA49F843E7F05AE34E98B3` |
| `runtime-data/.../002384-bundle.json` | `691F3F561B02523F00865F574F6FD373B202C9DAD98502ABBD61FA3B5958067F` |
| `runtime-data/.../002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3C14D4FBB29AEE31BC434B9C99B98DE3E79F6897581C4519A46AA87F236EB91F` |
| `runtime-data/.../002384-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `runtime-data/.../002384-report.json` | `6FA63686B889150551B42EAB66B3CE32F4246871F5A3D4BE99117D0E0D8917D4` |
| `runtime-data/.../002384-started.json` | `716537E8348F69818FFDC128970E509ED77B367443DC1D4A12292E2D972F87DF` |
| `runtime-data/.../002384-workflow.json` | `0CF91DFA99A0CA0B1DAFF3B8711E5E29AB1F07C1D693CFA7F986999ADC718EBD` |
| `runtime-data/.../002594-analysis.json` | `60C877932829D114EB02AF13304402EC5599B4410DF5BC63926F4F646489DE35` |
| `runtime-data/.../002594-bundle.json` | `1FD11C5F5E7764D23BD4950712FAF056EFEFF09436DD983635B24C156A7A8739` |
| `runtime-data/.../002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0F83C1CD96F5962402EAE69503E2C53CDF76E16F01A6ACF2F0324E986A036604` |
| `runtime-data/.../002594-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `runtime-data/.../002594-report.json` | `2867B270318B21E334C28246935326DAB19FA734C094253BB80637B2C32390C1` |
| `runtime-data/.../002594-started.json` | `7F1B87714DEA542920E07235206AF7DB367ABFC9F58CB4D043328C49DCB6FEF1` |
| `runtime-data/.../002594-workflow.json` | `43316166217675DF70473ED86CF646FA988DD3DFC53BE6C4E75F7F32BF6FF7F6` |
| `runtime-data/.../summary.json` | `E9999CF1FF2173C1CE5D87387ABB0C65D9473426B5334547285499F0F51F9228` |

本地既存日志、临时资料和缓存文件清单（哈希前后相同）：

| 路径 | SHA-256 |
|---|---|
| `runtime-launch.stderr.log` | `351B524197FB492920789369E7F1A271420C757633FBB553B280A181AC4C31A4` |
| `runtime-launch.stdout.log` | `EA93372C48C44A34C6D7D691C229901CF837F4E3302179988DF289D21C8620F9` |
| `plugins/document/parsers/docling/bridge/__pycache__/docling_bridge.cpython-312.pyc` | `9D9E4B46CF54604BB8651A97EC7FF792928858F9FDBA33110973293591079EF4` |
| `tmp/p0-19-client-042ddaa.log` | `1346395212BD3C5694A93CF95610F58A86B90AB03B70D125DAEC790C61C5AEAD` |
| `tmp/p0-19-client-8edffe8.log` | `9FDDBA4A604ED234EB1A49F695AD80DB15D22CD72CA9540258F6F1BD09B915BC` |
| `tmp/p0-19-client-da166c0.log` | `763E4C54DC26E3BD427338817EF477623AB47F69B0DF567DC5CC990DD9B42B49` |
| `tmp/p0-19-client-dcfb144.log` | `4FCD1A099071E605548E381A4812B919FE0125417AC5CC680BEC84519C3BF867` |
| `tmp/p0-19-client-f722b74.log` | `D727E960425ABFFA30E69D1A9472903B75FC61B635082F6671C9E76892FF7FE5` |
| `tmp/p0-19-node-042ddaa-comparison.json` | `DC9BB0375A2F8785B9578E67D504F3FAE6F41B9BB4340E16F9034D865DFE1719` |
| `tmp/p0-19-node-042ddaa.log` | `97CF3D9E8DB3527C7A46FBE548386C36C45BF6F0E34FAF114BFA0203563F6CBE` |
| `tmp/p0-19-node-8edffe8-comparison.json` | `608D92406F7C0E461AE81F18331A2419013855499AA4036982F42F9B44C55153` |
| `tmp/p0-19-node-8edffe8.log` | `72BA423EC3EBAA173E1145D430D873888E69D599588FAE78A8D384C5FC8C9430` |
| `tmp/p0-19-node-da166c0.log` | `8F6A7541A3A7616141EA7C6BD4D47BE88E4D61C6182EF36584AFD7FDF76BFCC9` |
| `tmp/p0-19-node-dcfb144.log` | `1690C3CAF3595907927E80E1FB51198001FEFD993C5AFB6AFFA7D647375D0A1D` |
| `tmp/p0-19-node-f722b74-comparison.json` | `8105BF1B866970633ACAF1BB7C368253E89937EC2ECFFBAA6F08B53434F216C7` |
| `tmp/p0-19-node-f722b74.log` | `E23066DEB93E7597AB68BE04F508E9B7C6FE96C4086C336109729AB4332DD4E9` |
| `tmp/p0-19-post-methods-node.log` | `23919D95F7D3B695967D8A3EB37DFDD5CCADC3E5F58296C9947E9B78DB9B5AC6` |
| `tmp/pdfs/byd-guoyuan-01.png` | `D9A1BE29B62E2F34C79D78468040628ABC01E3F451B035FE3808A1749ED7BD21` |
| `tmp/pdfs/byd-guoyuan.pdf` | `9FB3CF2691A39C93A5D54D0A2D432E696CDF0458DE569619BE48475C5469C0E7` |
| `tmp/pdfs/byd-huajin-1.png` | `92145318F251D3C44A85A70F5810F1449D905E37E7C8AEB387A0E107EBC36206` |
| `tmp/pdfs/byd-huajin.pdf` | `BAE22415F59317BBE0D7F14CB1EC15B43AA343D6B2F1938CF610E0B887EDCB87` |
| `tmp/pdfs/byd-kaiyuan-1.png` | `A1D35B4B050D529A52E45BA65C33177B906B2BC80B59FA1C862D32413CB51976` |
| `tmp/pdfs/byd-kaiyuan.pdf` | `A50E0177944F3E354ADB7A4BD5A9D2456537C4772A9405F894A2B6CCA23E658F` |
| `tmp/pdfs/dongshan-dongwu-page1.png` | `ABBBF1262AC5598FEA9B4344FDC132B4134C12C1F7A34F1661174C5AB6A60EC5` |
| `tmp/pdfs/dongshan-dongwu.pdf` | `05E601F8CEC4777576787193714B1B993DF96F2023BD98495C75ACD22F3CAF35` |
| `tmp/pdfs/dongshan-kaiyuan-1.png` | `DAEA1E8260A4A0A087E38AE4C160C5008D5666BB6AC6C7AE2D9DEA7E1EA5D484` |
| `tmp/pdfs/dongshan-kaiyuan-page1.png` | `2D77C773E62072A2B92ECD88459E07CA9FB2804F49C57328DFBF8EBD1B2AC773` |
| `tmp/pdfs/dongshan-kaiyuan.pdf` | `D0374050BB511385CFBDD4EBD95FECD56D50AF645CFDAEF59AB0DD613C0FA841` |
| `tmp/pdfs/dongshan-shanghai-1.png` | `B3BCB0DC497A90270A388BB8FCE4E3A8D372C34EA7A0B38756074D8747F49D5C` |
| `tmp/pdfs/dongshan-shanghai-page1.png` | `4855FE85418707DF15CF4688F58A3D9F962F8BF11CF8F1B77C1D12BB452D24ED` |
| `tmp/pdfs/dongshan-shanghai.pdf` | `E3C1EDBE5527FE865747B12F8B4E9C356C8C816B0122D6410B63852031CCDDB2` |

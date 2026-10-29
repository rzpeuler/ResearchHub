# P0-USE-001 — 公司研究前端阅读验收与最小呈现对齐

**执行基线 / 冻结远端 SHA**：`bdae675c1bc506ab067c2e5279a69984b107f00c`  
**执行分支**：`codex/company-research-p0-01-06`  
**最终状态**：`PARTIAL`  
**P0-19**：`NOT_ACCEPTED`；两份既有真实运行仍为 `17/19 blocked`

## 结论与范围

`/reports` 的 React 页面消费 JSON 报告，原有顶部只显示“研究尚未完成”和章节覆盖率；失败章节名称及原因只在折叠的原始 issues 中。此前 Markdown exporter 的改进不等于 React 页面已展示具名缺口。本轮只在有 `researchQuality` 的 `company_research` 报告顶部按失败 `sectionChecks` 显示短摘要：章节标题来自已存在的 section ID/title；限制说明只翻译已存在的已知 reason code，其他原因使用“本节未通过完整研究验收，原因见审计明细”。原始 `quality.issues` 原样保留在原折叠区，质量结果、正文、证据、数据与运行身份均未修改。

修改文件仅限：

- `client/src/components/ResearchReportBody.tsx`
- `client/src/components/ResearchReportBody.test.tsx`
- `docs/engineering/reports/2026-10-29-company-research-p0-use-001.md`

## Gate A — 页面与目录链路

源码核对：`client/src/App.tsx` 的 ReportsPage 在 `/reports` 调用 `RuntimeClient.listResearchReports(20)`，即 `GET /api/research-reports?limit=20`；选择条目后 `getResearchReport(reportId)` 请求 `GET /api/research-reports/:reportId`。选择逻辑校验响应 `reportId` 与请求一致及 `workflowRunId` 格式；对 conversation artifact 还会校验目标 runId。JSON 的 `sections` 和 `researchQuality` 交由 `ResearchReportBody`，引用附录由 `ReportAppendix` 渲染并以 `reportId:workflowRunId` 作为组件身份。API 服务目录读取实现位于 `app/services/research-service.ts`，只扫描 `runtime-data/reports/*.md.json` 并按同名文件读取详情。

两份本次指定归档位于 `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/`，文件名为 `002594-report.json` / `002384-report.json` 及各自 Markdown。它们不是 `runtime-data/reports/<reportId>.md.json`，不会被现有报告目录自动发现；当前报告目录内也没有这两个 reportId 的文件。本机未发现 ResearchHub API 监听进程。因此未声称归档可由原生目录或实时 API 读取。

| 核对项 | 结果 |
|---|---|
| 17/19 与完成状态 | JSON 为 `coreCoverage=17/19, passed=false, status=incomplete`；React 顶部显示“研究尚未完成”及 17/19。 |
| 两处具名失败初始展示 | 修改前不显示，issues 在折叠区；修改后组件初始 DOM 显示“乐观、基准与悲观情景”和“预期差”，并列出有 reason 支持的限制。组件测试通过；真实浏览器未运行。 |
| 原始 issues | 继续在原“查看未完成事项”折叠区完整呈现；测试展开后核对原值。 |
| 19 节正文、章节导航与偏好 | 组件回归核对 19 节标题与正文仍存在；既有章节定位、隐藏/恢复、引用开关及偏好持久化测试仍覆盖。 |
| 引文与附录 run 绑定 | 源码按报告自身证据定位和 `workflowRunId` 传递；组件引用事件含当前 `reportId`。`ReportAppendix` 对无 Bundle / Workflow 快照提供有限不可用提示（“该报告没有可用研究资料包”/“历史阶段不可用：未找到 Workflow 快照”）。未运行真实附录 API，实际 run/Bundle 可用性 `NOT_TESTED`。 |
| Markdown exporter 与 React | 已区分：exporter 修改不会自动进入 React；本轮变更只落在 React 组件与其测试。 |

## Gate D — 真实归档身份与阅读记录

两份归档 JSON 与上次登记的 SHA-256 一致；均含 19 个章节且顺序相同。原始响应未改写。`summary.json` 将两次 run 标为 `blocked`，Knowledge integrity 为 readonly 且记录 `knowledgeUnchanged=true`。

| 公司 / 身份 | runId / reportId / asOf | 结论、驱动与反证（均来自原报告） | 跟踪项与两处缺口 | 旧估值与 PIT 限制 |
|---|---|---|---|---|
| 比亚迪 002594 | run `82bcc425-d48d-4e55-bc45-111aa8c28ba4`；report `company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4`；`2026-10-27T20:19:59.628Z` | 核心判断：电池/电子制造积累支撑新能源车、智能化及算力基础设施拓展，协同与资本回报尚未验证（`investment-thesis`: `official-c19c34dd239b2e9c@paragraph:198,3251,167`）。两项驱动：闪充/储能方案与智能化布局（`investment-thesis`: `official-c19c34dd239b2e9c@paragraph:164,166`）；服务器出货、液冷冷板量产爬坡（同节 `@paragraph:342,347,561`）。最强反证：2026H1 汽车相关产品收入同比下降 8.98%，电子及其他产品增长未能抵消；分行业与分产品口径不可混同（`growth-drivers`: `official-c19c34dd239b2e9c@paragraph:691,692,693`; `risks`: `@paragraph:707,708,706`）。 | 跟踪分产品收入、利润与经营现金流/资本开支，辅以应收与存货变化（`monitoring-checklist`: `official-c19c34dd239b2e9c@paragraph:707,708,762`; `akshare-financial-002594@paragraph:1`）。缺口 1：`bull-base-bear` 为 `RESEARCH_GAP`，缺目标年销量/产品收入、利润率、现金流驱动的 Bear/Base/Bull 可复算区间；节内没有归属证据定位，经营背景见 `investment-thesis@official-c19c34dd239b2e9c@paragraph:164,342,561`。缺口 2：`variant-perception` 的机构 FY2026 EPS 历史数值版本未验证，且无可核验公司指引/独立本方预测（`ths-institution-1a4ec86fd02fb02431f1462b570c66c1599034abaef7da8ea4ba1ecd03930d4c@paragraph:1`）。 | 原文显示 2026-10-27 收盘价 82.01 CNY/share、FY2025 EPS 3.58、参考 PE 22.91（`valuation`: `company-valuation-market-002594-2026-10-27@paragraph:1`; `official-f7c8d23d2829a5e8@paragraph:231`）。响应 `retrievedAt=20:20:02.952Z` 晚于 `asOf` 3.324 秒；上游 `PIT=safe` 不证明历史数值版本。允许原文原样显示，但不得称为合格历史价格或历史 PE；本轮不回填旧报告。 |
| 东山精密 002384 | run `860916a8-4958-4d29-8da1-56ad5dd1c2c6`；report `company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6`；`2026-10-27T20:26:46.347Z` | 核心判断：制造与多产品基础向 AI 基础设施器件延伸，投资兑现取决于高端 PCB、光模块与收购整合能否带来稳定交付和现金回报（`investment-thesis`: `official-39e591fa149e4543@paragraph:821,816`; `official-296fff2b2889c26f@paragraph:584,585`）。两项驱动：EML 芯片用于高速模块、较高规格芯片进入量产（`investment-thesis`: `official-296fff2b2889c26f@paragraph:359,360,362`）；AI PCB 与光模块商业化及 GMD/索尔思整合（同节 `official-39e591fa149e4543@paragraph:885,886,887,888,889,890,891`）。最强反证：前五大客户占年度销售 64.33%，最大客户 46.46%；静态占比不是实际损失额（`risks`: `official-39e591fa149e4543@paragraph:937,939,965,968,969,970`）。 | 跟踪前五大及最大客户占比、分产品收入/占比、光模块产品毛利率及现金转化（`monitoring-checklist`: `official-39e591fa149e4543@paragraph:862,863,864,866,873,874,875,876,877,885,886,887,888,889,890,891,965,968,969,970`）。缺口 1：`bull-base-bear` 为 `RESEARCH_GAP`，无目标年经营驱动的 Bear/Base/Bull 可复算区间；节内无归属证据定位，经营背景见 `investment-thesis@official-39e591fa149e4543@paragraph:821,885,886`。缺口 2：`variant-perception` 的机构 FY2026 EPS 历史数值版本未验证，且无可核验公司指引/独立本方预测（`ths-institution-1eeca550b3f48876041cea01536bba455c8df681e5f9f219aa719731bed6d1fd@paragraph:1`; `eastmoney-akshare-report-03d2bceac83d3b2e93b76a77a4667aa084b51f6243d9a2fef4e387e31b90627f@paragraph:1`）。 | 原文显示 2026-10-27 收盘价 101.09 CNY/share、FY2025 EPS 0.79、参考 PE 127.96（`valuation`: `company-valuation-market-002384-2026-10-27@paragraph:1`; `official-39e591fa149e4543@paragraph:233`）。响应 `retrievedAt=20:26:49.604Z` 晚于 `asOf` 3.257 秒；不得将该值表述为已验证历史版本。旧报告原样保留，本轮不回填。 |

两公司都能从原始归档读取核心判断、增长驱动、反证、跟踪指标和两个失败章节；这是对已保存报告的内容核对，不是新的质量审查，也不改变 `17/19`。`bull-base-bear` 本身没有可归属 locator，以上明确标注其 locator 缺失，并只用研究结论节定位已披露经营背景；没有把背景来源冒充为情景假设证据。

## 测试与执行边界

| 命令 | 结果 |
|---|---|
| `npm run client:test -- src/components/ResearchReportBody.test.tsx` | 0；12/12 通过，包含 17/19 双失败章节、19/19 通过、未知章节 18/19、旧报告兼容、非公司报告兼容；已有引用、章节与偏好测试通过。 |
| `npm run client:test -- src/app/report-navigation.test.tsx` | 1；4 个用例中 2 通过、2 失败：`opens a no-report bundle from its durable original conversation Activity` 与 `rejects another run returned to a conversation artifact request` 均找不到 `View Research Bundle`。冻结基线 `bdae675c1bc506ab067c2e5279a69984b107f00c` 上以原组件重跑得到完全相同的 2 个失败、2 个通过；不是本次差异。 |
| `node --import tsx --test tests/app/services/research-report.test.ts` | 0；17/17 通过。 |
| `npm run client:typecheck` | 0。 |
| `npm run typecheck -- --pretty false` | 0。 |
| `npm run client:build -- --outDir <系统临时目录>` | 0；Vite 生产构建成功，只有既有大 chunk 提示。产物未写回仓库。 |
| `git diff --check` | 0；仅有受保护既存文件 LF/CRLF 提示。 |
| 完整 Node/Client 回归 | `NOT_RUN`。 |

React 测试采用 `client/vitest.config.ts` 的 `root: client`，因此 filter 参数为 `src/...`。本机无 ResearchHub listener，也没有可用浏览器自动化运行时；Codex 的 Node REPL 中 Playwright 模块无法载入。故 `React UI=COMPONENT_ONLY`，真实点击/截图与 API/附录 E2E 均 `NOT_RUN`，不得将 jsdom 组件测试称为浏览器验收。无稳定、已验证的本地 `/reports` URL，故用户入口 `NOT_AVAILABLE`；归档 Markdown 可直接通过本报告旁的仓库归档文件打开。

模型调用：0；外部数据采集：0；Knowledge 写入：0；真实研究重跑：0；归档 JSON/Markdown、生产报告目录和运行配置均只读。没有修改 P0-19 门槛，没有修改历史报告，没有新增依赖。

## Git 与受保护对象

冻结基线与 `origin/codex/company-research-p0-01-06` 初始 SHA 均为 `bdae675c1bc506ab067c2e5279a69984b107f00c`。本次报告记载的实现提交 SHA 与最终远端 HEAD 在提交后补录；提交仅包含上述三个白名单文件。既有 5 个 dirty JSON、15 个归档 sidecars、日志、缓存与 `tmp/` 文件逐项记录 SHA-256，执行前后比较应完全一致；哈希表附于本报告末尾。用户文件未暂存、覆盖或清理。

**实现提交 SHA**：`bb47db1`（组件 + 测试，2 files changed, 79 insertions, 1 deletion）。  
本验收报告单独提交；其父提交为上述实现提交。报告提交及最终远端 HEAD 由交付回执核验，避免在报告中写入无法自引用的自身 SHA。

## 受保护文件 SHA-256（执行前 = 执行后）

| 受保护文件 | SHA-256（前 = 后） |
|---|---|
| `plugins/document/parsers/docling/bridge/__pycache__/docling_bridge.cpython-312.pyc` | `9D9E4B46CF54604BB8651A97EC7FF792928858F9FDBA33110973293591079EF4` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-analysis.json` | `72588193FAFF4C2E75FB2E07C0B07197619B8C23B9FA49F843E7F05AE34E98B3` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-bundle.json` | `691F3F561B02523F00865F574F6FD373B202C9DAD98502ABBD61FA3B5958067F` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3C14D4FBB29AEE31BC434B9C99B98DE3E79F6897581C4519A46AA87F236EB91F` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-report.json` | `6FA63686B889150551B42EAB66B3CE32F4246871F5A3D4BE99117D0E0D8917D4` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-started.json` | `716537E8348F69818FFDC128970E509ED77B367443DC1D4A12292E2D972F87DF` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-workflow.json` | `0CF91DFA99A0CA0B1DAFF3B8711E5E29AB1F07C1D693CFA7F986999ADC718EBD` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-analysis.json` | `60C877932829D114EB02AF13304402EC5599B4410DF5BC63926F4F646489DE35` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-bundle.json` | `1FD11C5F5E7764D23BD4950712FAF056EFEFF09436DD983635B24C156A7A8739` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0F83C1CD96F5962402EAE69503E2C53CDF76E16F01A6ACF2F0324E986A036604` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-report.json` | `2867B270318B21E334C28246935326DAB19FA734C094253BB80637B2C32390C1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-started.json` | `7F1B87714DEA542920E07235206AF7DB367ABFC9F58CB4D043328C49DCB6FEF1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-workflow.json` | `43316166217675DF70473ED86CF646FA988DD3DFC53BE6C4E75F7F32BF6FF7F6` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/summary.json` | `E9999CF1FF2173C1CE5D87387ABB0C65D9473426B5334547285499F0F51F9228` |
| `runtime-launch.stderr.log` | `351B524197FB492920789369E7F1A271420C757633FBB553B280A181AC4C31A4` |
| `runtime-launch.stdout.log` | `EA93372C48C44A34C6D7D691C229901CF837F4E3302179988DF289D21C8620F9` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4C02302A5B31CEC6D93B9298E06A76BD0B834B4BACC914670C7FD06AA6300038` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252FD35DEC70403FD6BB8B3EDC6FFADD25211FD158461A1DDE30458BF07F442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `EF0E7475E0464CA1E3950FEB348B0D3ED6DC7383E32200FAA3FC413207BC641A` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12C951BE5CA88FB35B155187055B0A15A50D212133C9B68088C0D1674500C0FA` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61CD5CF5B24A7F0FC10746E0269A845D6E29464614C43738D7585EC075FB4670` |
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

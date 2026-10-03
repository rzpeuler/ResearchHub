# Theme Framework 候选刷新实施计划

依据：[候选刷新设计](../specs/2026-10-03-theme-framework-candidate-refresh-design.md)。仅覆盖 Source/Raw 新增后的旧候选重新审阅，不扩展 Theme 更新或自动知识接受。

1. **后端证明与刷新服务**：在 Theme Framework Service 中增加只读的 revision 链校验，逐个核对受治理 Writer 收据与 Source/Raw；检查原候选状态、KB 身份、全部证据绑定及正文 locator。产生稳定的新 run ID、来源元数据与独立 candidate 事件。复用现有安全落盘、幂等与当前 revision 检查，任何证据或状态不明均阻断。用临时 Schema 0.4 KB 覆盖成功、重放、篡改、缺收据、非 Source 写入、证据失效和并发变化。
2. **HTTP 与前端审阅**：新增受 Runtime token／Origin 保护的刷新路由；客户端在 stale 运行显示刷新入口和来源／revision 提示。刷新后加载新 candidate，沿用既有逐项决定与接受界面。覆盖请求边界、旧候选不变、刷新结果显示和错误状态。
3. **真实数据验证与交付**：先跑类型检查、相关服务／HTTP／前端测试和前端构建；在 `ai-compute-theme-v04-verified` rev3 上只执行一次受验证刷新并核对旧／新候选、证据和 KB revision 不变。向用户呈现具体节点及关系供逐项确认；在其确认前不执行 accept。更新实施记录、复核 Git diff，fetch、推送分支；待 E 阶段真实写入、图谱和 D3 闭环完成后再按批准的主线流程合入 `main`。

# Knowledge Layer Industry Graph Prototype

这是一个只依赖静态 JSON 的前端验证原型，不包含数据库、图数据库、RAG 或 LLM 抽取。

## 启动

在仓库根目录执行：

```bash
npx tsx tests/knowledge/serve.ts
```

然后打开 `http://localhost:4173/tests/knowledge/index.html`。

原型验证内容：

- AI Hardware 产业全景与 marketSize 面积映射
- Data Center → Server → GPU / Liquid Cooling / Rack Assembly 嵌套导航
- 常驻右侧节点信息、公司画像、上市状态与上市公司关联
- 环节市场份额及公司业务营收面积映射
- 关联研报链接与事件时间轴

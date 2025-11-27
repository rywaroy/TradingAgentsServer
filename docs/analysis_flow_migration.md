# TradingAgents-CN 分析流程移植（Node 优先，仅 A 股）任务手册

## 🎯 目标 & 背景

- 背景：`TradingAgents-CN` 已实现完整多智能体股票分析（校验 → 工具注入 → 市场/新闻/情绪/基本面 → 多空辩论 → 交易员 → 风险裁决 → 结构化决策）。`TradingAgentsServer` 目前仅有占位代码，需落地真实流程。
- 范围：仅 **A 股**，路由 `/analysis/single` 必须返回真实数据与结构化决策。
- 原则：Node 优先实现原链路，只有在 A 股数据源缺乏 Node 能力（如 akshare 专属）时才使用 Python 兜底。
- 目标：完成 `src/services/analysisService.ts` 的伪代码替换，并按模块拆分数据源、业务拼装、路由，保持与 `analysis_flow.md` 节点顺序和字段一致。
- 用法（提示词场景）：执行前阅读本手册 + `../TradingAgents-CN/docs/analysis_flow.md`，按任务清单逐项勾选，确保模块化与字段对齐。

## 🔗 参考来源

- 流程文档：`../TradingAgents-CN/docs/analysis_flow.md`
- Python 关键链路：`app/services/simple_analysis_service.py:_run_analysis_sync` → `TradingAgentsGraph.propagate`
- Python 校验与市场识别：`tradingagents/utils/stock_validator.py::prepare_stock_data_async`，`tradingagents/utils/stock_utils.py::StockUtils.get_market_info`
- Node 入口：`src/routes/analysis.ts`
- Node 占位代码：`src/services/analysisService.ts`（`runAnalysis` 与 `fetch*` 系列）

## 🧭 原链路速记（对照 Node 实现）

1. 校验与市场识别：校验代码、市场、分析日期，返回币种等基础信息。
2. 工具注入：行情/新闻/情绪/基本面统一接口。
3. 多智能体序列：市场 → 新闻 → 社交 → 基本面 → 多空辩论（Bull/Bear）→ 研究经理 → 交易员 → 风险辩论 → 风险裁决。
4. 结构化输出：`reports`（市场/新闻/情绪/基本面/研究/交易/风险），`decision`（action/target/confidence/risk_score/reasoning/model_info），`performance_metrics`。

## 🛠️ 约束与原则

- **Node 优先**：能用 Node 库/HTTP API 就不用 Python；仅在 A 股行情/基础数据需要 akshare 等专属库时调用 Python 子进程。
- **字段对齐**：遵循 Python 端 `AnalysisParameters/AnalysisResult` 字段与默认值。
- **可执行代码**：文档内给出的代码片段可直接替换当前伪代码运行（需安装相应依赖与配置环境变量）。
- **流程必读**：实现前必须通读 `../TradingAgents-CN/docs/analysis_flow.md`，确保节点顺序、职责与输出字段一致。
- **模块化实现**：不要把所有逻辑塞进单文件，按职责拆分（数据源客户端/业务拼装/路由控制器），便于后续维护与替换。

## ✅ 任务清单（完成用 [x] 标记）

- [x] 任务 1：接口模型与路由校验对齐（仅 A 股）

  - 源码位置：`src/routes/analysis.ts`、`src/services/analysisService.ts`。
  - 工作：
    - 扩充 `AnalysisParameters`：`market_type`、`analysis_date`、`research_depth`、`selected_analysts`、`include_sentiment`、`include_risk`、`quick_analysis_model`、`deep_analysis_model`。
    - 扩充 `AnalysisResult`：`trader_investment_plan`、`risk_management_decision`、`investment_plan`、`performance_metrics.exec_ms`、`decision.model_info`。
    - 路由校验限制为 **A 股 6 位数字**（`^\d{6}$`），`market_type` 仅传 `"A股"`。

- [x] 任务 2：股票校验与市场识别（Node 实现，Python 兜底，仅 A 股）

  - 源码位置：`src/services/analysisService.ts` 新增 `validateSymbol`、`detectMarket`。
  - Node 方案：使用本地正则校验 6 位数字，必要时调用 A 股数据源（如东方财富开放接口）做二次验证。
  - Python 兜底：在仅有 akshare 能力时调用 Python：
    ```ts
    import { spawn } from "child_process";
    async function validateByPython(symbol: string, analysisDate: string) {
      return runPy("validate.py", { symbol, analysis_date: analysisDate });
    }
    ```

- [ ] 任务 3：数据获取替换占位实现（Node + axios，仅 A 股，逐类拆分）

  - 源码位置：`src/services/analysisService.ts` 的 `fetchMarketData` / `fetchNews` / `fetchSentiment` / `fetchFundamentals`。
  - 通用：所有 HTTP 调用统一用 **axios**，设定超时与重试，错误信息需包含源接口/请求参数。
  - [x] 3.1 行情（替换 `fetchMarketData`）
    - 目标：返回收盘价、MA20、日期。
    - 来源建议：东方财富/聚宽等 A 股日线 REST；无 Node 库则用 axios 直接调。
    - 处理：若接口不含 MA20，则用近 20 日收盘价自行计算；无数据抛错。
  - [x] 3.2 新闻（替换 `fetchNews`）
    - 目标：返回标题与初步影响值。
    - 来源建议：国内可访问的新闻/公告接口或 RSS；缺 KEY 时可用免费源。
    - 处理：字段缺失兜底空字符串，保证返回数组。
  - [ ] 3.3 情绪（替换 `fetchSentiment`）
    - 目标：返回 `score`（0-1，>0 偏多）。
    - 方法：对 3.2 新闻标题做情感分析（词典或 LLM/API）；无数据返回 0。
  - [ ] 3.4 基本面/财报（替换 `fetchFundamentals`）
    - 目标：返回 `pe`、`growth`。
    - 来源建议：A 股财报/估值接口；若无则 akshare 兜底。
    - 处理：缺失字段置 0，并记录日志。
  - 示例骨架（需替换为真实 A 股接口）：
    ```ts
    import axios from "axios";
    async function fetchMarketData(
      symbol: string,
      date: string
    ): Promise<MarketData> {
      const url = `https://your-a-share-api/market?k=${symbol}&d=${date}`;
      const { data } = await axios.get(url);
      const { close, ma20 } = data;
      if (!close) throw new Error("无行情数据");
      return { price: close, ma20: ma20 ?? close, date };
    }
    async function fetchNews(symbol: string): Promise<NewsItem[]> {
      const url = `https://your-a-share-api/news?k=${symbol}`;
      const { data } = await axios.get(url);
      return (data.items || []).map((a: any) => ({
        title: a.title || "",
        impact: "neutral",
      }));
    }
    async function fetchSentiment(symbol: string): Promise<SentimentData> {
      // 可基于 fetchNews 结果或情绪 API 计算
      return { score: 0.0 };
    }
    async function fetchFundamentals(
      symbol: string
    ): Promise<FundamentalsData> {
      const url = `https://your-a-share-api/fundamentals?k=${symbol}`;
      const { data } = await axios.get(url);
      return { pe: data?.pe ?? 0, growth: data?.growth ?? 0 };
    }
    ```

- [ ] 任务 4：报告生成与多角色输出（Node 版替换伪代码）

  - 源码位置：`src/services/analysisService.ts` 的 `buildMarketReport` / `buildNewsReport` / `buildSentimentReport` / `buildFundamentalsReport` / `buildBullView` / `buildBearView` / `synthesizeResearch`。
  - Node 版最小可执行样例（可直接覆盖现有拼装逻辑）：
    ```ts
    function buildBullView(
      marketReport: string,
      fundamentalsReport: string
    ): string {
      return `看多理由：\n${marketReport}\n${fundamentalsReport}`;
    }
    function buildBearView(
      sentimentReport: string,
      newsReport: string
    ): string {
      return `看空理由：\n${sentimentReport}\n${newsReport}`;
    }
    function synthesizeResearch(bull: string, bear: string): string {
      return `研究结论：综合多空观点\n${bull}\n${bear}`;
    }
    ```
  - 若需 LLM 生成（推荐）：引入 `openai`/`dashscope` 客户端，用角色提示词复刻 Python 多角色 Prompt，产出 `market_report` 等文本。

- [ ] 任务 5：交易员与风险裁决 Node 实现

  - 源码位置：`src/services/analysisService.ts` 的 `buildTradePlan`、`evaluateRisk`。
  - 可执行示例：
    ```ts
    function buildTradePlan(researchDecision: string): TradePlan {
      // 可换成 LLM 生成
      return {
        action: "买入",
        target: 1.05, // 相对现价可乘以 1.05
        confidence: 0.6,
        recommendation: "买入，目标价 +5%，持有 3-6 个月",
        summary: "综合多空后偏多",
        keyPoints: ["趋势向上", "估值可接受"],
        reasoning: researchDecision,
      };
    }
    function evaluateRisk(tradePlan: TradePlan): RiskDecision {
      const score = 0.35; // 或基于波动/情绪生成
      return {
        level: score > 0.6 ? "高" : score > 0.3 ? "中" : "低",
        score,
        detail: "基于波动与情绪的简单风险评估",
      };
    }
    ```

- [ ] 任务 6：结构化决策与性能字段补齐

  - 源码位置：`src/services/analysisService.ts` 的 `runAnalysis` 返回体。
  - 工作：填充 `reports` 中的 `trader_investment_plan`、`risk_management_decision`，`decision.model_info`，`performance_metrics.exec_ms`（用 `Date.now()` 前后差）。

- [ ] 任务 7：Python 兜底（仅 akshare 等无法替代场景）

  - 源码位置：`src/services/analysisService.ts` 新增 `runPy` 辅助，按需在 `fetchMarketData`/`fetchFundamentals` 中分支调用；Python 脚本放 `TradingAgentsServer/py-bridge/`。
  - 示例：
    ```ts
    import path from "node:path";
    function runPy(script: string, payload: any): Promise<any> {
      const py = spawn(
        "python3",
        [path.resolve(__dirname, "../py-bridge", script)],
        { stdio: ["pipe", "pipe", "inherit"] }
      );
      return new Promise((resolve, reject) => {
        let out = "";
        py.stdout.on("data", (c) => (out += c.toString()));
        py.on("close", (code) =>
          code === 0
            ? resolve(JSON.parse(out))
            : reject(new Error(`python exit ${code}`))
        );
        py.stdin.write(JSON.stringify(payload));
        py.stdin.end();
      });
    }
    ```

- [ ] 任务 8：测试与验收
  - 源码位置：`tests/analysis.e2e.ts`（新增）。
    - 输入示例代码（A 股与美股各 1 个），断言 `reports.market_report`、`reports.final_trade_decision`、`decision.action`、`performance_metrics.exec_ms` 存在。
    - 模拟错误代码，断言 400/错误提示。

## 📰 3.2 新闻取数与兜底（A 股内源：akshare + 新浪爬虫）

- **当前策略（暂不接入 Mongo，不用 Google/OpenAI）**：1）Python/akshare `stock_news_em`（按代码）→ 2）新浪财经列表页抓取 + 详情页解析；全部失败返回空数组。
- **akshare 主路径（Python）**：`py-bridge/news_sync.py` 读取 `{symbol,max_news}`，调用 `ak.stock_news_em(symbol)`，按时间降序截取，输出 `{title, impact: "neutral", source, publish_time, summary, url, content, author}`；调用方式 `runPy("news_sync.py", { symbol, max_news })`，超时建议 15s，失败返回空列表。
- **新浪兜底（Node 爬虫）**：列表页 `https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllNewsStock/symbol/<前缀+代码>.phtml`（前缀规则：60/68/90→sh，00/20/30→sz，8/4→bj，默认 sh），抓取 `.datelist a` 前 10 条链接，逐个访问详情页解析 `.main-title`（标题）、`.date`（时间）、`.source`（来源）、`#artibody`（正文，去掉 HTML），字段映射同 akshare 输出。
- **返回结构要求**：`fetchNews` 返回结构化数组，不返回字符串；各源必须通过 `normalizeNewsItem` 统一 `title` 为空用 `""`，`impact` 仅允许 `"pos"|"neg"|"neutral"`，缺失一律 `"neutral"`；最终兜底返回 `[]`（供 3.3 情绪按 0 分处理）。

## 📌 提交前核对

- 伪代码/占位实现全部被可执行逻辑替换。
- 必要依赖写入 `package.json`（如 `yahoo-finance2`, `node-fetch`, `openai`）。
- 环境变量说明（如 `NEWS_API_KEY`, `OPENAI_API_KEY`）写入 README 或 .env.example。
- 纯 Node 路径优先，Python 仅在确实没有 Node 替代时调用。

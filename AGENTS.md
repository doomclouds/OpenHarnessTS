# OpenHarness Agent Instructions

## 项目目标

这个仓库用于开发 OpenHarness 的 TypeScript 版本。

参考项目位于根目录下的 `OpenHarness/`，它是 Python 版 OpenHarness 的本地参考副本，只用于阅读、对照和架构迁移，不纳入本仓库 Git 管理，也不要在常规开发中修改它。

项目对外名称统一使用 **OpenHarness**。`OpenHarnessTS` 只作为当前仓库目录名或必要的工程区分名称；面向用户、文档、系统提示词、运行时身份和产品语义时，不要写成 “OpenHarnessTS” 或 “OpenHarness TS”，而应写成 “OpenHarness 的 TypeScript 版本/实现”。

OpenHarness 的 TypeScript 版本目标不是机械翻译 Python 代码，而是用 TypeScript/Node.js 生态重新实现一套轻量、可扩展、可检查的 Agent Harness 基础设施，核心能力包括：

- agent loop：消息、模型响应、工具调用、流式事件与循环控制
- tools：工具定义、JSON schema、执行上下文、结果封装
- skills/plugins：Markdown skill、插件目录、命令、hook 和 agent 扩展
- memory/context：项目上下文发现、长期记忆、会话恢复、上下文压缩
- permissions/hooks：权限模式、路径/命令规则、PreToolUse/PostToolUse 生命周期
- providers：OpenAI/Anthropic-compatible 等 provider workflow
- CLI/TUI：后续提供 `oh` 风格入口，但先保证核心库边界清楚

## 参考项目导航

优先阅读这些参考资料：

1. `OpenHarness/README.md`
2. `OpenHarness/README.zh-CN.md`
3. `OpenHarness/src/openharness/`
4. `OpenHarness/tests/`

当需要理解 Python 原始实现、模块关系、调用链或架构边界时，优先使用 `codegraph` 查询参考项目，而不是手工全量翻文件：

- `projectPath` 使用 `OpenHarness/` 的绝对路径：`C:\WorkSpace\ResearchProjects\OpenHarnessTS\OpenHarness`
- 先用 `codegraph_status` 确认参考项目索引正常；如果没有索引或索引明显不对，先在仓库根目录运行 `codegraph init OpenHarness`
- 问“某功能怎么工作 / 某模块架构 / bug 可能在哪”时，优先用 `codegraph_context` 获取入口点和相关符号
- 如果 `codegraph_context` 入口不够准，先用 `codegraph_search` 找精确符号，再用 `codegraph_node` 读取符号主体
- 追踪明确的调用链时用 `codegraph_trace`
- 分析变更影响时用 `codegraph_impact`
- 已验证的 Python agent loop 关键符号：
  - `QueryEngine.submit_message`：`src/openharness/engine/query_engine.py`
  - `run_query`：`src/openharness/engine/query.py`
  - `_execute_tool_call`：`src/openharness/engine/query.py`
  - `QueryContext`：`src/openharness/engine/query.py`

根目录下的 `graphify-out/` 是参考项目曾经生成过的图谱产物，当前不作为默认代码导航入口。除非用户明确要求查看或维护 graphify 产物，否则不要依赖它来回答 Python 源码问题，也不要更新、移动或重建它。

## 仓库边界

- `OpenHarness/` 是参考项目，保持 Git ignored。
- `src/` 是 TypeScript 源码工程。
- `test/` 是 TypeScript 测试工程。
- `dist/`、`.tsbuild/`、`coverage/`、`node_modules/` 都是生成物或依赖目录，不提交。

## TypeScript 工程规则

- 使用 ESM，`package.json` 中 `type` 为 `module`。
- 使用 TypeScript project references：
  - 根 `tsconfig.json` 只做引用聚合。
  - `src/tsconfig.json` 负责编译库代码到 `dist/`。
  - `test/tsconfig.json` 负责测试类型检查。
- Node.js 目标版本为 20+。
- 新增代码默认放在 `src/`，测试放在 `test/`。
- 源码内注释使用英文，文档和协作说明默认使用中文。
- ESM 下本地 TypeScript import 使用 `.js` 后缀，例如 `import { x } from "./x.js"`。

## 常用命令

```powershell
npm install
npm run typecheck
npm run test
npm run build
```

PowerShell 中不要用 `&&` 串命令；需要顺序执行时用 `;` 或拆成多次命令。

## 开发优先级

当前骨架先建立最小 runtime：

1. 工具定义和执行上下文
2. 工具注册、查找、执行和错误封装
3. 测试工程与类型检查

后续扩展时按参考项目能力逐步迁移：

1. agent loop 与 stream events
2. provider workflow
3. permission checker
4. skills loader
5. plugins/hooks
6. memory/context
7. CLI/TUI

每次迁移前先定位参考项目对应模块，再决定 TypeScript 侧的模块边界。不要为了“像原项目”牺牲 TypeScript 生态下更自然的抽象。

## Milestone 导航

长期复刻路线和月度进度台账放在 `docs/milestones/`：

- 总索引：`docs/milestones/INDEX.md`
- 当前 core 里程碑：`docs/milestones/2026-06/openharness-core-mvp/README.md`

`docs/milestones/` 用于记录阶段目标、slice checklist 和关联资产；具体 slice 的设计 spec、implementation plan 和完成归档仍放在 `docs/superpowers/` 对应目录中。

### Milestone 管理方式

里程碑用于管理“这个阶段要完成什么、现在做到哪、哪些 slice 已经有 spec/plan/archive 证据”。它是项目级进度账本，不替代 Superpowers 的设计、计划、归档和问题记录。

目录结构按月份和里程碑名称组织：

```text
docs/milestones/
  INDEX.md
  2026-06/
    openharness-core-mvp/
      README.md
      CHECKLIST.md
```

#### 什么时候使用里程碑

- 开始一个阶段性目标前，先读 `docs/milestones/INDEX.md` 找当前活跃里程碑。
- 做 OpenHarnessTS 复刻路线、阶段范围、优先级、验收边界讨论时，使用里程碑文档。
- 判断当前工作属于哪个 slice、是否已经开始、是否完成、是否已有 spec/plan/archive 时，使用该里程碑的 `CHECKLIST.md`。
- 用户问“现在进度到哪了”“接下来做哪块”“这个月 core 要完成什么”时，优先从里程碑和 checklist 回答。
- 如果一个任务不属于当前里程碑，先判断它是否应该进入后续里程碑，而不是直接塞进当前 checklist。

#### 什么时候更新里程碑

- 新建、拆分、合并或关闭一个阶段性目标时，更新 `docs/milestones/INDEX.md`。
- 新建里程碑时，在对应月份目录下创建里程碑目录，并至少包含 `README.md` 和 `CHECKLIST.md`。
- 一个 slice 开始前，如果已经产生 design spec 或 implementation plan，把链接写入 `CHECKLIST.md`。
- 一个 slice 完成后，更新 `CHECKLIST.md` 的 checkbox、状态、完成证据和 archive 链接。
- `CHECKLIST.md` 的完成数量变化后，同步更新本里程碑 `README.md` 的进度摘要和 `docs/milestones/INDEX.md` 的 `Status` / `Progress`。
- 如果实现过程中发现 slice 范围不准，可以调整 checklist，但要保留清楚的原因或在相关 spec/plan 中说明。
- 不要把任务级步骤塞进里程碑 checklist；细粒度执行步骤应写进 `docs/superpowers/plans/`。

#### Milestones 和 Superpowers 的关系

- `docs/milestones/` 是路线图和进度账本：回答“这一阶段要做什么、做到哪了、有哪些交付证据”。
- `docs/superpowers/specs/` 是具体 slice 的设计规范：回答“这个功能/模块应该怎么设计，边界和验收是什么”。
- `docs/superpowers/plans/` 是具体 slice 的实施计划：回答“按什么步骤实现和验证”。
- `docs/superpowers/archives/` 是完成后的交付归档：回答“已经交付了什么、怎么验证的、还有什么后续边界”。
- `docs/superpowers/problems/` 和 `docs/superpowers/inbox/` 记录复用问题、故障模式或暂存信号，不承担里程碑进度职责。

推荐流程：

1. 在 milestone `README.md` 定义阶段目标和验收边界。
2. 在 milestone `CHECKLIST.md` 拆出少量可验收 slice。
3. 对即将实现的 slice 写 Superpowers spec。
4. 基于 spec 写 Superpowers plan。
5. 实施并验证。
6. 完成后写 Superpowers archive。
7. 回填 milestone `CHECKLIST.md` 和 `INDEX.md`。

简单说：milestone 管方向和进度，Superpowers 管单个 slice 的设计、实施、归档和经验沉淀。

## 技术债导航

未解决技术债放在 `docs/technical-debt/`，和 `docs/milestones/`、`docs/superpowers/` 同级。它是项目级债务账本，不属于里程碑内容，也不替代 Superpowers 的 spec、plan、archive、problem 或 inbox。

- 总索引：`docs/technical-debt/INDEX.md`
- 目录按月份组织，例如 `docs/technical-debt/2026-06/`
- 索引用表格展示技术债，并用独立 `Status` 列标记 `Open` / `Closed`

评估当前里程碑下一个 slice、判断是否需要先还债、或回答“还有哪些债没处理”时，先查看 `docs/technical-debt/INDEX.md`。如果某条技术债影响当前 milestone 的验收边界，再把它作为 slice 选择或设计输入，而不是直接混入 milestone checklist。

## 验证要求

完成代码改动后，至少运行与改动范围匹配的验证命令：

- 类型或接口改动：`npm run typecheck`
- runtime 行为改动：`npm run test`
- 构建相关改动：`npm run build`

如果依赖尚未安装，先运行 `npm install`。如果验证无法运行，要在回复里明确说明原因和已完成的替代检查。

## Git 规则

- commit message 使用英文 Conventional Commits。
- 不要提交 `OpenHarness/`。
- 不要提交生成物：`dist/`、`.tsbuild/`、`coverage/`、`node_modules/`。
- 合并到 `main` 时默认保留 merge 节点，不使用快进合并。

<!-- asset-compounding-guidance:start -->
## Asset Compounding Retrieval Guide

This repository uses hook-assisted asset compounding from the `superpowers-asset-compounding` plugin. Keep this `AGENTS.md` block as repository-specific retrieval anchors only; generic routing, plan-boundary checkpoints, closeout reminders, and `asset_gate` nudges belong to the plugin hooks and skills.

If the plugin was just installed or upgraded, review and trust the bundled hooks with `/hooks` before relying on lifecycle automation.

### Asset Directories

- Specs: `docs/superpowers/specs/`
- Plans: `docs/superpowers/plans/`
- Archives: `docs/superpowers/archives/`
- Problems: `docs/superpowers/problems/`
- Inbox: `docs/superpowers/inbox/`

If one of these directories does not exist, do not assume there is no asset. Search the existing directories first, then inspect current code and tests before guessing.

### Retrieval Order

When continuing feature work, explaining prior decisions, or checking whether a requirement is already delivered:

1. Search `docs/superpowers/specs/` and `docs/superpowers/plans/` for the intended behavior and implementation plan.
2. Search `docs/superpowers/archives/` for completed delivery history.
3. Search `docs/superpowers/problems/` for stable reusable failure modes, root causes, and recovery rules.
4. Search `docs/superpowers/inbox/` for uncertain but possibly reusable signals.
5. If no asset answers the question, inspect current code and tests before guessing.

Preferred keyword search:

```powershell
rg -n "<topic-keyword>" docs/superpowers/specs docs/superpowers/plans docs/superpowers/archives docs/superpowers/problems docs/superpowers/inbox
```

### Hook-Owned Workflow

- `SessionStart` injects a short asset protocol when `docs/superpowers/` exists.
- `PostToolUse` records compact signals from edits, verification, git closeout commands, and main-agent plan updates.
- `Stop` may request one more pass when meaningful work lacks an `asset_gate`.
- `PreCompact` / `PostCompact` preserve pending asset signals across compaction.

Subagent lifecycle hooks are intentionally not used for asset compounding. The main agent owns final route decisions and repository asset writes. Use the plugin skills and scripts when the hook-provided context indicates an archive, problem, inbox, or update is needed.
<!-- asset-compounding-guidance:end -->

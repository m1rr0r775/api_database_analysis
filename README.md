# AI 数据分析与可视化平台（AI Data Analysis Platform）

一个面向“数据分析 + 自动出图”的轻量平台：支持 **上传 CSV/Excel** 或 **直连数据库（MySQL/PostgreSQL/SQLite）** 获取数据，通过右侧 AI 对话生成分析结论与多图看板，并支持导出分享。

## 功能概览
- **多数据源**：CSV/Excel 上传；数据库连接 + SQL（仅 SELECT/CTE）查询并落成数据表
- **会话机制**：一次会话管理多张数据表，AI 分析时自动汇总上下文
- **AI 分析**：兼容 DeepSeek/OpenAI/本地 OpenAI-format 端点，支持生成单图或多图看板
- **可视化与导出**：图表编辑与看板导出（PNG / PDF / Excel）
- **安全与可读报错**：统一错误格式（detail/hint/error_id），数据格式问题给出可理解的提示

## 目录结构
- `backend/`：FastAPI 后端（上传/会话/AI/数据库模块）
- `frontend/`：React + TypeScript + Vite 前端（数据源、编辑器、看板、导出）
- `uploads/`：会话数据表落盘目录（运行时生成）
- `backend/data/`：数据库连接与查询记录等本地数据（运行时生成；已忽略提交）

## 端口与地址
| 服务 | 默认端口 | 地址 | 说明 |
|---|---:|---|---|
| 前端开发服务器（Vite） | 5173 | http://127.0.0.1:5173 | 浏览器访问入口 |
| 后端 API（FastAPI/Uvicorn） | 8000 | http://127.0.0.1:8000 | API 服务 |
| API 文档（Swagger UI） | 8000 | http://127.0.0.1:8000/docs | 在线调试 |

前端在开发模式下会把 `/api/*` 代理到后端 `8000`（见 `frontend/vite.config.ts`）。

## 快速开始（本地开发）
### 1) 后端启动
1. 进入后端目录并创建虚拟环境：

```bash
cd backend
python -m venv venv
```

2. 安装依赖（Windows 推荐用 venv 的 pip）：

```bash
.\venv\Scripts\pip.exe install -r requirements.txt
```

3. 配置环境变量：
- 复制 `backend/.env.example` 为 `backend/.env`
- 填写 AI 相关配置（至少需要 `AI_API_KEY`）

4. 启动后端：

```bash
.\venv\Scripts\python.exe run.py
```

后端默认监听：`http://127.0.0.1:8000`

### 2) 前端启动
1. 进入前端目录并安装依赖：

```bash
cd frontend
npm.cmd install
```

2. 启动开发服务器：

```bash
npm.cmd run dev
```

前端默认地址：`http://127.0.0.1:5173`

## 使用指南（浏览器）
### 文件上传分析
1. 在 “Upload Data File” 选择 CSV/Excel 上传（可多选）
2. 右侧输入分析目标，例如：
   - “帮我生成销售分析看板，包含趋势、Top 产品、区域分布”
   - “检查这份数据是否有缺失值/重复行，并给出清洗建议”

### 数据库直连分析
1. 在 “数据库数据源” 新建连接（MySQL/PostgreSQL/SQLite）
2. 使用 SQL 编辑器编写查询（仅允许 SELECT/CTE），建议先 `LIMIT 10` 预览
3. 点击 “执行并加入数据表” 将结果保存到会话，随后像上传文件一样进行 AI 分析

## 配置说明（backend/.env）
常用配置项：
- `AI_PROVIDER`：默认 `deepseek`（也可按需扩展）
- `AI_API_KEY`：AI 服务 Key
- `AI_BASE_URL`：OpenAI-format Base URL（默认 DeepSeek）
- `AI_MODEL_NAME`：模型名
- `AI_CONTEXT_ROWS`：每张表给 AI 的预览行数（默认 10）
- `UPLOAD_PREVIEW_ROWS`：上传/落表预览行数（默认 10）
- `UPLOAD_MAX_BYTES`：单文件最大字节（默认 20MB）
- `UPLOAD_ALLOWED_EXT`：允许扩展名（默认 `.csv,.xls,.xlsx`）
- `DB_ENCRYPTION_KEY`：数据库连接密码加密密钥（为空会自动生成本地密钥文件）
- `DB_QUERY_PREVIEW_ROWS`：数据库查询预览行数（默认 1000）
- `DB_QUERY_SAVE_MAX_ROWS`：单次查询保存最大行数（默认 100000）
- `DB_QUERY_TIMEOUT_SECONDS`：数据库查询超时（默认 15 秒，MySQL/PG 生效）
- `CORS_ALLOW_ORIGINS`：CORS 允许来源列表（逗号分隔；默认仅本机前端）
- `API_KEY`：可选接口鉴权（请求头 `X-API-Key`，为空则不启用）
- `DATA_DIR`：后端本地数据目录（默认 `backend/data/`）

## 数据与隐私
- `backend/data/`：保存数据库连接信息（密码加密存储）、保存查询、查询历史等
- `uploads/`：会话数据表落盘目录（CSV/Excel 上传文件与数据库查询结果）
- 建议：不要提交真实数据与 `.env`；默认 `.gitignore` 已忽略上述目录/文件

## 部署建议（生产）
本仓库默认面向本地开发。若需要部署：
- 后端使用 `uvicorn app.main:app --host 0.0.0.0 --port 8000`（按需加反向代理与鉴权）
- 前端 `npm run build` 产物在 `frontend/dist`，可由 Nginx/静态站点托管，并将 `/api` 反代到后端

## 安全说明（重要）
- **开发环境**：Vite dev server 已默认绑定 `127.0.0.1`，请不要暴露到不可信网络（WiFi/公网）
- **数据库查询**：仅允许 `SELECT/CTE`，并拦截多语句与危险关键字，防止误操作写库/删库
- **生产必做清单**：
  - 配置 `API_KEY` 并在前端请求头带上（或接入完整登录/权限体系）
  - 配置 `CORS_ALLOW_ORIGINS` 为你的前端域名（不要使用 `*`）
  - 限制后端访问范围：仅对内网/反向代理开放，避免直接暴露到公网
  - 定期清理 `uploads/` 与 `backend/data/` 中的运行时文件，避免磁盘膨胀
  - 如导出文件会被外部打开，已内置 Excel 公式注入转义，但仍建议对外分发前做安全扫描

## License
MIT License. See [LICENSE](LICENSE).

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security
See [SECURITY.md](SECURITY.md).

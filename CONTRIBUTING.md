## 贡献指南（CONTRIBUTING）

欢迎提交 Issue / Pull Request。为了让协作更顺畅，请遵循以下约定。

### 开发环境
- Windows / macOS / Linux 均可
- Python 3.8+
- Node.js 16+

### 启动项目（开发模式）
后端：

```bash
cd backend
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
.\venv\Scripts\python.exe run.py
```

前端：

```bash
cd frontend
npm.cmd install
npm.cmd run dev
```

### 代码风格
- 前端：TypeScript，尽量保持函数与组件职责单一，错误提示走统一的 `formatApiError`
- 后端：FastAPI，优先使用 HTTPException 返回结构化 `detail/hint/error_id`，避免泄露堆栈

### 提交前检查（建议）
- 前端：`npm.cmd run build`
- 后端：`.\venv\Scripts\python.exe -m compileall app`

### PR 说明
请在 PR 描述里写清楚：
- 解决的问题（Issue 链接或场景描述）
- 改动范围（后端/前端/接口）
- 自测方式（截图/命令/步骤）


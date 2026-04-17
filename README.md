# Fullstack Book App (Frontend + Backend + Supabase)

该项目已改造为前后端一体：
- 前端：React + Vite (`src/`)
- 后端：Express + TypeScript (`server/`)
- 数据库：Supabase（表结构在 `supabase/schema.sql`）

## 1. 环境准备

1. 安装依赖
```bash
npm install
```

2. 创建 `.env.local`（可参考 `.env.example`），至少配置：
```env
PORT=8787
VITE_BACKEND_URL=http://localhost:8787
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 2. 初始化 Supabase

在 Supabase SQL Editor 中执行：
- `supabase/schema.sql`

注意：本次版本新增了 `book_files` 表和 `books` storage bucket，请确保重新执行一次该 SQL。

## 3. 启动项目

一条命令同时启动前后端：
```bash
npm run dev:full
```

访问前端：
- http://localhost:3000

后端健康检查：
- http://localhost:8787/api/health

## 4. 后端 API

- `GET /api/bookshelf`：获取书架
- `POST /api/bookshelf`：新增书籍到书架
- `PATCH /api/bookshelf/:id`：更新书籍（归档等）
- `DELETE /api/bookshelf/:id`：删除书籍
- `GET /api/library`：获取发现页书库
- `POST /api/books/upload`：上传 `txt/epub` 到 Supabase Storage，并入库到书架
- `GET /api/books/:id/chapters`：解析 `txt/epub` 章节与目录
- `GET /api/books/:id/reading-progress`：获取阅读进度（章节）
- `PUT /api/books/:id/reading-progress`：保存阅读进度（章节 + 章内滚动百分比）
- `DELETE /api/library/:id`：从 library 删除书籍（并级联删除 bookshelf + 文件）

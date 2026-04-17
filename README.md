# Fullstack Reading App (React + Express + Supabase)

本项目已实现前后端一体：
- 前端：React + Vite（`src/`）
- 后端：Express + TypeScript（`server/`）
- 数据与文件：Supabase（表结构见 `supabase/schema.sql`）

## 1. 环境准备

1. 安装依赖
```bash
npm install
```

2. 创建 `.env.local`（参考 `.env.example`），至少包含：
```env
PORT=8787
VITE_BACKEND_URL=http://localhost:8787
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 2. 初始化 Supabase

在 Supabase SQL Editor 执行：
- `supabase/schema.sql`

## 3. 本地启动（Web）

```bash
npm run dev:full
```

- 前端：`http://localhost:3000`
- 后端健康检查：`http://localhost:8787/api/health`

## 4. Android Studio 模拟器运行

本项目已接入 Capacitor，并默认支持 Android Emulator 访问本机后端：`http://10.0.2.2:8787/api`。

1. 启动后端（保持运行）
```bash
npm run dev:server
```

2. 同步 Web 资源到 Android 工程
```bash
npm run android:sync
```

3. 打开 Android Studio
```bash
npm run android:open
```

4. 在 Android Studio 中选择模拟器并点击 Run

说明：
- 已开启 Android 明文 HTTP（开发环境）
- 后端已开启 CORS，便于模拟器联调
- 如果你有公网 HTTPS，可在 `.env.local` 设置 `VITE_API_BASE_URL` 覆盖默认地址

## 5. 生成可安装 APK（Debug/Release）

### 前置条件（必须）

1. 已安装 Android Studio（含 SDK）
2. 已安装 JDK 17（推荐使用 Android Studio 自带 JBR 或独立 JDK 17）
3. `JAVA_HOME` 与 `PATH` 配置正确

Windows 示例：
```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
java -version
```

### Debug APK（可直接安装测试）

1. 执行打包命令
```bash
npm run android:apk:debug
```

2. 产物路径
- `android/app/build/outputs/apk/debug/app-debug.apk`

3. 安装到已启动模拟器（可选）
```bash
cd android
gradlew.bat installDebug
```

### Release APK（正式发布包）

Release 包需要签名。已支持通过 `android/keystore.properties` 自动读取签名配置。

1. 生成签名文件（首次一次）
```bash
keytool -genkeypair -v -keystore android/app/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

2. 创建签名配置文件
- 复制 `android/keystore.properties.example` 为 `android/keystore.properties`
- 按实际信息填写：
```properties
storeFile=app/upload-keystore.jks
storePassword=你的store密码
keyAlias=upload
keyPassword=你的key密码
```

3. 打包 Release APK
```bash
npm run android:apk:release
```

4. 产物路径
- `android/app/build/outputs/apk/release/app-release.apk`

### Release AAB（上架 Google Play 推荐）

```bash
npm run android:aab:release
```

产物路径：
- `android/app/build/outputs/bundle/release/app-release.aab`

## 6. 常用 API

- `GET /api/bookshelf`：获取书架
- `POST /api/bookshelf`：加入书架
- `PATCH /api/bookshelf/:id`：更新书籍（归档等）
- `DELETE /api/bookshelf/:id`：删除书架书籍
- `GET /api/library`：获取书库
- `POST /api/books/upload`：上传 `txt/epub`
- `GET /api/books/:id/chapters`：解析章节与目录
- `GET /api/books/:id/reading-progress`：读取阅读进度
- `PUT /api/books/:id/reading-progress`：保存阅读进度（章节 + 章内滚动）
- `DELETE /api/library/:id`：从书库删除（联动删除书架与文件）

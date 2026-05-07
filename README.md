# MIS 课件批量下载器

针对北京交通大学 MIS 课程平台的浏览器扩展（目前支持edge和chorme），支持批量扫描和下载所有课程的电子课件。

---

## 功能特性

- **课程列表自动加载**：打开插件后自动在后台打开课程中心页，提取本学期全部课程
- **批量扫描课件**：一键扫描所有课程，或按课程单独扫描，列出可下载 / 受限文件
- **按目录结构下载**：文件保存路径为 `根目录/课程名/子文件夹/文件名`，自动分类
- **智能扩展名识别**：4 级优先链确保绝大多数文件获得正确扩展名（见下方技术说明）
- **防 MIS 过期**：可开启"防过期"开关，每 5 分钟自动向 MIS 发心跳，避免下载途中 Cookie 失效
- **停止扫描 / 停止下载**：随时中断，已下载的文件不受影响
- **下载进度日志**：实时显示每个文件的下载状态（成功 / 失败 / 中断）

---

## 系统要求

| 要求 | 说明 |
|------|------|
| 浏览器 | Chrome / Chromium（Manifest V3） |
| 网络 | 校园网或 VPN（能访问 `123.121.147.7:88`） |
| 登录状态 | 已在浏览器中登录 MIS（`mis.bjtu.edu.cn`） |

---

## 安装方法

1. 下载本仓库，解压到本地任意目录
2. 打开 Chrome → 地址栏输入 `chrome://extensions/`
3. 右上角开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `course-downloader-extension` 文件夹
5. 扩展图标出现在工具栏后，点击即可打开操作界面

---

## 使用步骤

1. **确保已登录 MIS** 并处于校园网 / VPN 环境，顶部状态栏应显示 `MIS ✓` 和 `课程平台 ✓`
2. 等待左侧课程列表自动加载（约 5–15 秒）
3. 点击 **🔍 扫描全部课件** 或对单个课程点击 **扫描**
4. 在"课件浏览"标签中勾选文件，点击 **⬇ 下载选中**
   - 也可在左侧勾选课程，点击 **⬇ 下载已选** 下载该课程所有可下载文件
5. 切换到"下载进度"标签查看实时日志

> **建议**：下载大量文件时开启"防过期"开关，防止 MIS 会话在下载途中失效。

---

## 技术说明

### 认证机制

平台使用双重认证：
- **MIS Cookie**：浏览器自动携带，用于课程平台主页鉴权
- **`sessionId` 请求头**：从课程平台页面的 JS 脚本中提取（32 位大写十六进制），调用课件列表 / 下载 URL 等 API 时必须携带

### 关键 API

| 接口 | 说明 |
|------|------|
| `GET /back/coursePlatform/course.shtml?method=getCourseList` | 获取课程列表（API 回退方案） |
| `GET /back/coursePlatform/courseResource.shtml?method=stuQueryUploadResourceForCourseList` | 获取课程课件列表 |
| `POST /back/resourceSpace.shtml?method=rpinfoDownloadUrl&rpId=xxx` | 解析文件真实下载 URL，返回 `{ rpUrl: "..." }` |

### 扩展名识别（4 级优先链）

下载代理 URL 形如 `/download.shtml?p=rp&f=xxx`，路径无法直接判断文件类型。插件按以下顺序尝试获取正确扩展名：

1. **Content-Disposition 响应头**（优先级最高）  
   解析 `filename*=UTF-8''...`、GBK 编码、`filename="..."` 等多种格式，含 `decodeURIComponent` 容错
2. **Content-Type 映射**  
   将 MIME 类型映射到对应扩展名（pdf / pptx / docx / xlsx / mp4 等）
3. **HEAD 重定向目标路径**  
   若下载代理将请求重定向到实际文件 URL（如 `/uploads/xxx.pptx`），从 `head.url` 提取扩展名
4. **魔数检测**（兜底）  
   发送 `Range: bytes=0-7` 读取文件头 8 字节，识别：
   - `%PDF` → `.pdf`
   - `PK\x03\x04` → `.pptx`（ZIP-based Office）
   - `\xD0\xCF\x11\xE0` → `.ppt`（OLE2 legacy Office）
   - `\xFF\xD8\xFF` → `.jpg`
   - `\x89PNG` → `.png`
   - `Rar!` → `.rar`
   - `7z\xBC\xAF` → `.7z`
   - `\x1F\x8B` → `.gz`

扫描阶段也会从 `rpName`（文件名字段）本身提取扩展名作为 `fileType` 的补充来源。

### 遇到的问题与解决方案

#### 问题一：大量文件下载后无扩展名

**原因**：  
- 平台 API 的 `RP_PRIX` 字段对许多文件返回字符串 `'undefined'`（而非空值）
- `rpName` 本身不含扩展名（如 "Lecture_1_Ch01_Introduction_1"）
- 下载代理 URL 以 `.shtml` 结尾，路径提取逻辑正确排除了它，但也因此无法获得扩展名

**解决方案**：  
建立上述 4 级优先链，魔数检测作为最终兜底，扫描阶段同步补充 `fileType` 来源。

#### 问题二：URL 路径误识别服务端脚本后缀

**原因**：  
早期代码直接取 URL 路径的最后一个 `.xxx`，将 `.shtml` 误识别为文件扩展名。

**解决方案**：  
维护服务端脚本后缀黑名单（`.shtml .html .htm .php .asp .aspx .jsp .do .action .cgi .pl`），命中则跳过路径提取，继续下一优先级。

#### 问题三：Service Worker 重启后 `pageTabId` 丢失

**原因**：  
Chrome MV3 的 Service Worker 在空闲时会被浏览器终止，重启后内存变量全部丢失，导致无法向插件页面广播下载进度。

**解决方案**：  
`broadcastToPage` 函数先尝试缓存的 `pageTabId`，失败后动态查询 URL 匹配 `src/page/page.html` 的标签页，同时每次收到页面消息时顺带恢复 `pageTabId`。

#### 问题四：GBK 编码导致中文乱码

**原因**：  
平台页面和部分 API 使用 GBK 编码，`sessionId` 等关键信息通过服务端渲染内嵌在 JS 脚本中。

**解决方案**：  
通过正则从页面 `document.scripts` 中提取 `setRequestHeader('sessionId', 'XXXX')` 模式，直接读取原始字符串，绕过编码问题。API 请求使用 `fetch` + `json()` 时浏览器根据 `Content-Type` 自动处理编码。

---

## 项目结构

```
course-downloader-extension/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background/
    │   └── background.js   # Service Worker：课程列表/文件扫描/下载队列/keep-alive
    ├── content/
    │   └── content.js      # 内容脚本（注入 MIS 和课程平台页面）
    └── page/
        ├── page.html       # 插件主界面
        ├── page.css
        └── page.js         # 界面交互：渲染/扫描控制/进度监听
```

---

## 注意事项

- 本插件仅供个人学习使用，请遵守学校相关规定
- 若课程列表加载失败，可点击界面右上角"↻"重新检测，或手动打开课程中心后再试
- 文件名中的特殊字符（`\ / : * ? " < > |`）会被替换为下划线

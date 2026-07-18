# BeatZ Fit

> 用音乐驱动每一次训练 — 沉浸式音乐健身桌面应用

BeatZ Fit 将 **音乐播放器**、**3D 音频可视化** 与 **健身训练管理** 融合为一体。每首歌的封面驱动独特的 3D 可视化效果，让你的训练不再单调。

## ✨ 核心特性

- **3D 唱片架音乐库** — 拖拽、缩放、点击交互的 3D 唱片墙，支持本地音乐 / 网易云音乐 / QQ音乐
- **音频驱动 3D 可视化** — 6 种预设主题，实时跟随音频频谱：
  - **共鸣 Resonance** — 几何粒子随音乐律动，Curl Noise 有机运动，可拖拽缩放
  - **棱镜 Prism** — 圆角矩形透镜畸变，专辑封面填充，可拖拽缩放
  - **核璇 Nucleus** — 3000 胶囊体中心核，玻璃球环绕，可拖拽缩放
  - **穹璇 Orbis** — 封面切割成穹顶，跟随节奏震动
  - **星屑 Étoile** — 歌曲封面粒子化重构，可拖拽旋转、滚轮缩放
  - **雾扰 Nuage** — 空灵状态，仅保留底层烟雾流体背景，无 3D 物体
- **液态玻璃 UI** — 全自定义 Liquid Glass 组件系统
- **健身训练管理** — 1500+ 健身动作库，按部位/器械筛选，自定义训练计划
- **训练数据看板** — 3D 深度弧 KPI 卡片 + 柱状图 / 环形图 / 趋势线 / 热力图
- **桌面歌词** — 独立透明窗口，鼠标穿透 + 悬浮显示
- **DIY 个性化** — 3D 视觉参数、歌词样式、极光色彩实时调节
- **交互音效系统** — 4 种音效（detent / airBloom / retract / confirm ）贯穿全应用

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Electron 33 |
| 前端框架 | Vue 3 (`<script setup>` + Composition API) |
| 构建工具 | Vite 6 + vite-plugin-electron |
| 语言 | TypeScript (strict) |
| 状态管理 | Pinia |
| 3D 渲染 | Three.js + troika-three-text |
| 动画 | GSAP |
| 音频引擎 | Howler.js |
| 数据库 | sql.js (SQLite WASM) |
| 音乐元数据 | music-metadata |
| 图像处理 | Electron nativeImage (内置) |
| 网易云 API | NeteaseCloudMusicApi |
| CSS | SCSS, 液态玻璃组件系统 |

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Windows 10+**

### 安装

```bash
git clone https://github.com/ZZ-Jie/BeatZFit.git
cd BeatZFit
npm install
```

### 字体

应用字体通过 [Google Fonts CDN](https://fonts.googleapis.com) 在线加载（见 `index.html` 中的 `<link>` 标签），包含 Sora、Space Grotesk、Inter、Noto Sans SC 等字体，无需手动下载字体文件。

### 开发运行

```bash
npm run dev
```

> **注意**：如果在 IDE（如 VS Code / Cursor）的终端中运行，可能需要先清除 `ELECTRON_RUN_AS_NODE` 环境变量：
> ```powershell
> $env:ELECTRON_RUN_AS_NODE=$null
> ```

### 构建

```bash
npm run build
```

构建产物输出到 `release/` 目录，生成 NSIS 安装程序（`BeatZ Fit Setup x.y.z.exe`）。安装程序默认安装到 `D:\BeatZ Fit`，应用数据存储在 `D:\BeatZ Fit\Data`。

### 测试

```bash
npm test
```

## 📥 下载

不想配置开发环境、普通用户，**推荐通过蓝奏云下载**：

- [**蓝奏云（推荐）**](https://wwbit.lanzoul.com/iLy2x3x8ptmb) ｜ 提取码：`ado6`
- [**GitCode Releases**](https://gitcode.com/Pluto_14/BeatZFit/releases/v1.0.1)
- ~~**Gitee Releases**~~ 已弃用。

> 开发者可 clone 本仓库自行 `npm install && npm run build`；各平台 Release 均提供 Windows NSIS 安装包。

## 📁 项目结构

```
BeatZFit/
├── electron/               # Electron 主进程
│   ├── main/
│   │   ├── db/             # SQLite 数据库 (sql.js)
│   │   ├── ipc/            # IPC 处理器
│   │   ├── services/       # 业务逻辑服务
│   │   └── windows/        # 窗口管理
│   └── preload/            # contextBridge 预加载
├── src/                    # Vue 3 渲染进程
│   ├── components/         # UI 组件 + 液态玻璃系统
│   ├── composables/        # Vue Composables
│   ├── modules/            # 可视化引擎 / 音乐模块 / 健身模块
│   ├── pages/              # 路由页面
│   ├── stores/             # Pinia 状态管理
│   ├── styles/             # 全局样式
│   ├── types/              # TypeScript 类型定义
│   └── utils/              # 工具函数
├── public/                 # 静态资源 (字体/图标/预设)
└── resources/              # 构建资源 (应用图标/预设)
```

## 📄 许可证

[MIT License](LICENSE)

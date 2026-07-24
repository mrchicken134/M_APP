# M_APP

**中文** | [English](#english)

M_APP 是一款面向 Windows 的本地个人工作台，使用 **Tauri 2、React、TypeScript 和 Rust** 构建。它把日历、待办事项、工作流队列、习惯、临时任务、系统提醒，以及 Codex 工作状态检测整合在一个桌面应用中。

- 本地优先：核心数据保存在电脑上的 JSON 文件中，不需要账号或云服务。
- 桌面体验：独立窗口、系统通知、关闭到托盘、置顶状态灯。
- 高效交互：拖拽排序、日期标签、智能清单、循环事项和等待队列。
- 中文界面：默认使用中文，适合日常个人任务与工作安排。

> 当前版本主要面向 Windows 10/11 x64。项目仍在持续开发中，暂不包含云同步、账号系统和多设备协作。

## 目录

- [主要功能](#主要功能)
- [安装与启动](#安装与启动)
- [使用教程](#使用教程)
- [Codex 状态检测](#codex-状态检测)
- [数据保存与备份](#数据保存与备份)
- [开发环境](#开发环境)
- [OpenCV 配置](#opencv-配置)
- [构建与打包](#构建与打包)
- [常见问题](#常见问题)
- [English](#english)

## 主要功能

### 📅 日历

- 月视图显示完整日期网格，相邻月份日期以灰色显示。
- 单击日期切换选中日期；双击日期可进入对应周的详细模式。
- 年份和月份按钮会打开选择窗口，点击窗口外部自动关闭。
- “今天”按钮可快速回到当天。
- 月视图日期格显示未完成事项点，最多显示 5 个。
- 日期格可显示 Emoji 标签，标签位于日期数字下层，不遮挡数字。
- 详细模式使用 `0–24` 小时时间轴：
  - 有开始和结束时间的事项按实际时长定位。
  - 只有开始时间或没有时间的事项使用简化展示。
  - 同一时间段的事项自动分栏，尽量避免重叠。
- 右侧显示当天标签、当天事项及当前选中事项的完整编辑器。
- 支持在日历中完成、取消完成、修改和删除事项。
- 月视图与详细模式之间带有连贯的展开、收缩和滑动动画。

### 🏷️ 日期标签

- 标签独立于事项清单，用来标记某一天的状态或类型。
- 顶部标签栏只显示图标，并提供新增与删除模式。
- 标签图标可从 Emoji 选择器中选择。
- 将标签拖到月视图日期格即可绑定到该日期。
- 拖动时显示图标跟随、目标格高亮和投放动画。
- 右侧当天标签栏支持添加和删除标签。
- 标签定义和日期绑定关系都会随应用数据保存。
- 详细周视图不显示日期标签，避免影响时间轴阅读。

### ✅ 事项列表

- 日历事项与待办事项使用同一套数据，修改后会在两个页面同步。
- 智能清单包括：
  - 今天
  - 即将到来
  - 重要
  - 已完成
  - 全部
- 支持创建、改名和删除自定义清单，并配置 Emoji 图标与颜色。
- 事项支持以下字段：
  - 标题与详情
  - Emoji 图标
  - 所属清单
  - 日期或无日期
  - 优先级
  - 提醒时间
  - 子任务
  - 完成状态
  - 每日、每周或每月循环
- 时间类型分为三种：
  - 开始和结束时间
  - 只有开始时间
  - 无时间
- 单击事项选中并在右侧编辑。
- 双击有日期的事项可跳转到日历对应日期。
- 支持搜索、按时间或优先级排序、完成、取消完成和删除。
- 完成循环事项时，当前事项会完成，并自动生成下一次事项。
- 已完成事项默认不计入月视图的未完成事项点。

### 🔄 工作流

工作流用于从已有内容中组合出一条“现在要做什么”的独立执行队列。

- 左侧“当前工作流”默认为空。
- 右侧同时显示事项、临时任务和习惯三个来源区。
- 从右侧拖入左侧时会创建工作流卡片；卡片是来源内容的工作流副本。
- 删除工作流卡片只会将它移出工作流，不会删除右侧来源。
- 删除右侧来源也不会删除已经加入工作流的卡片。
- 拖动排序采用明确的插入位置：
  - 拖到卡片上半区：插入该卡片前。
  - 拖到卡片下半区：插入该卡片后。
  - 拖到队列空白处：加入队尾。
- 拖动过程中显示跟随预览、插入线、队尾提示和等待区提示。
- 所有工作流卡片都可单独设置优先级，并使用不同边框颜色区分。
- 来源为事项的卡片会在标题右侧显示事项时间。
- 点击完成圆圈时：
  - 事项：完成原事项并移出工作流。
  - 临时任务：删除原临时任务并移出工作流。
  - 习惯：仅移出本次工作流，保留习惯来源。
- 双击右侧来源可编辑：
  - 事项打开完整事项编辑器。
  - 临时任务和习惯可编辑名称、详情和 Emoji 图标。

### ⏳ 等待区

- 将右侧来源或当前工作流卡片拖入等待区，会打开等待设置窗口。
- 可按两种方式设置等待：
  - 等待指定分钟数。
  - 等待到指定日期和时间。
- 到期后可选择加入工作流队头或队尾。
- 到期卡片回到工作流时：
  - 主界面显示提示。
  - Codex 状态悬浮窗右侧显示一个呼吸动画旗帜。
  - 点击悬浮窗即可确认，旗帜随后消失。
- 等待卡片会保留图标、详情和优先级，并可继续修改等待设置。

### 🚦 Codex 状态检测

- 应用可创建一个 `420 × 75` 的无边框置顶悬浮窗。
- 悬浮窗不进入任务栏，并可拖动到屏幕任意位置。
- 三种灯光状态：
  - 红色“工作中”：Codex 正在处理任务。
  - 黄色“审批中”：Codex 正在等待用户确认或检测出现异常。
  - 绿色“空闲中”：Codex 已完成或当前没有请求。
- 同时支持检测：
  - Codex 桌面版的停止按钮。
  - Codex CLI 的 `Ready`。
  - Codex CLI 的 `Working`。
  - Codex CLI 的命令审批提示。
- 检测器优先截取 Codex 或终端相关进程窗口，减少全屏无关内容造成的误判。
- 使用 OpenCV 归一化模板匹配，并按“审批 > 工作 > 空闲”的优先级选择结果。
- 每 `1` 秒检测一次，并通过连续帧规则降低状态闪烁。
- 支持多显示器。
- 状态检测页可查看：
  - 当前匹配状态。
  - 命中的窗口截图区域。
  - 匹配坐标、置信度和模板类型。
  - 模板分辨率、模板缩放、当前屏幕分辨率和屏幕缩放。
- 检测开关会被记忆：
  - 开启时，下次启动自动运行检测并显示状态灯。
  - 关闭时，立即停止检测并隐藏状态灯；下次启动也保持关闭。

### 🔔 提醒、托盘与桌面集成

- 事项到达提醒时间后发送 Windows 系统通知。
- 首次使用提醒时，系统可能要求通知权限。
- 关闭主窗口会将应用隐藏到系统托盘，而不是结束进程。
- 托盘菜单提供“打开”和“退出”：
  - “打开”恢复主窗口。
  - “退出”才会完全结束应用和后台检测。
- 跨天后，“今天”日期和智能清单会在一分钟内自动更新。
- 默认窗口大小为 `1600 × 900`，最小窗口大小为 `900 × 600`。
- 支持系统 `prefers-reduced-motion` 设置，减少非必要动画。

## 安装与启动

### 使用安装包

1. 获取项目构建出的 NSIS 安装包。
2. 双击 `M App_0.1.0_x64-setup.exe`。
3. 按安装向导完成安装。
4. 从开始菜单或桌面快捷方式打开 **M App**。
5. Windows 首次启动时如果显示安全提示，请确认安装包来自你信任的构建来源。

安装包用户不需要单独安装 Node.js、Rust、OpenCV 或项目源代码。

### 第一次使用

1. 打开“事项列表”，创建或选择一个清单。
2. 点击“新增”创建事项，填写标题、日期、时间和提醒。
3. 打开“日历”，确认事项已经显示在对应日期。
4. 在日历顶部创建 Emoji 标签，并拖到日期格。
5. 打开“工作流”，把右侧事项、临时任务或习惯拖到左侧。
6. 如需 Codex 状态灯，打开“状态检测”并启用检测。

## 使用教程

### 创建一个事项

1. 在左侧导航点击“事项列表”。
2. 选择“今天”“全部”或一个自定义清单。
3. 点击顶部“新增”，或在快速新增输入框中输入标题。
4. 在右侧编辑图标、标题、详情、日期和清单。
5. 选择时间类型：
   - “时间段”需要开始与结束时间。
   - “开始时间”只记录开始时间。
   - “无时间”不会在详细时间轴中占用时间段。
6. 根据需要设置优先级、提醒、循环和子任务。
7. 修改会自动保存，顶部保存状态会显示结果。

### 创建无日期事项

1. 选中事项。
2. 在右侧日期区域点击“无日期”。
3. 无日期事项会保留在事项列表中，但不会出现在某一天的日历格中。

### 使用日期标签

1. 打开日历月视图。
2. 点击顶部标签栏中的“+”。
3. 从 Emoji 窗口选择图标。
4. 按住标签并拖到目标日期格。
5. 如需删除标签，点击标签栏的删除按钮，再点击标签右上角的红色叉号。

### 安排工作流

1. 打开“工作流”。
2. 从右侧三个来源区按住卡片并拖到左侧队列。
3. 将卡片拖到其他卡片上半区或下半区调整位置。
4. 在卡片右侧选择优先级。
5. 完成当前卡片时点击圆形完成按钮。
6. 暂时不处理的卡片可拖到等待区，设置返回时间和返回位置。

### 完全退出应用

点击窗口关闭按钮只会隐藏主窗口。需要完全退出时：

1. 在 Windows 任务栏通知区域找到 M App。
2. 右键托盘图标。
3. 点击“退出”。

## Codex 状态检测

### 推荐设置

内置模板最初按 `2560 × 1440`、Windows 缩放 `125%` 制作。如果当前屏幕设置不同：

1. 打开“状态检测”页面。
2. 将“模板分辨率”设为 `2560 × 1440`。
3. 将“模板缩放”设为 `125%`。
4. 将“当前分辨率”设为正在运行 Codex 的显示器分辨率。
5. 将“屏幕缩放”设为该显示器在 Windows 设置中的缩放比例。
6. 开启检测，查看下方命中截图和置信度。

当前实现根据模板环境与目标屏幕环境计算单一匹配缩放比例。若识别不准确，请先确认分辨率和 Windows 缩放设置，而不是反复切换开关。

### 检测限制

- 检测依赖 Codex 或终端窗口能够被 Windows 截图接口捕获。
- 某些使用硬件加速、受保护内容或特殊渲染方式的窗口可能无法完整捕获。
- CLI 终端历史中如果保留完整的旧状态文字，模板匹配无法理解它是不是“当前行”。
- 修改终端字体、颜色主题、字重或文字抗锯齿方式，可能降低匹配率。
- 模板文件位于 `scripts/`，打包时会作为资源包含。

## 数据保存与备份

### 桌面应用数据

核心数据保存到 Tauri 应用数据目录中的：

```text
app-data.json
```

Windows 上通常位于：

```text
C:\Users\<用户名>\AppData\Roaming\com.mapp.desktop\app-data.json
```

该文件包含：

- 事项与完成状态
- 自定义清单
- 日期标签与日期绑定
- 习惯与临时任务
- 当前工作流顺序
- 等待区内容
- 已触发提醒记录

状态检测还会使用：

```text
codex-status.json
codex-detector-settings.json
codex-match.png
workflow-return-alert.json
```

开发模式下，这些检测运行文件可能出现在项目根目录；安装版在无法使用项目目录时会放到应用数据目录。

### 备份

1. 从托盘菜单完全退出 M App。
2. 复制 `app-data.json` 到安全位置。
3. 恢复时，将备份文件放回原目录并覆盖旧文件。
4. 重新启动 M App。

直接编辑 JSON 前请先备份。格式错误会导致应用回退到默认数据或显示读取失败。

### 网页预览

`npm.cmd run dev` 只启动网页前端。网页环境无法调用 Tauri 的 Rust 文件接口、系统托盘、窗口控制和内置屏幕检测，因此它适合检查界面，不适合作为完整桌面应用使用。完整功能请运行 `npm.cmd run tauri dev`。

## 开发环境

### 必需软件

- Windows 10/11 x64
- Node.js 24 LTS 与 npm
- Rust stable，目标为 `x86_64-pc-windows-msvc`
- Microsoft Visual Studio Build Tools：
  - Desktop development with C++
  - MSVC 工具链
  - Windows 10/11 SDK
- OpenCV 4.12 Windows x64
- LLVM/Clang 与 `libclang`

确认环境：

```powershell
node -v
npm -v
rustc -V
cargo -V
```

安装前端依赖：

```powershell
git clone https://github.com/mrchicken134/M_APP.git
cd M_APP
npm.cmd install
```

启动网页界面预览：

```powershell
npm.cmd run dev
```

启动完整桌面开发模式：

```powershell
npm.cmd run tauri dev
```

## OpenCV 配置

Codex 检测使用 Rust `opencv` crate。当前仓库按以下本机目录配置：

```text
D:\Document\Work\m_prooject\
├─ opencv-4.12.0\opencv\build\
│  ├─ include\
│  └─ x64\vc16\
│     ├─ bin\opencv_world4120.dll
│     └─ lib\
├─ clang-18\Library\bin\clang.exe
└─ libclang\clang\native\
```

如果依赖安装在其他位置，需要同步修改：

1. `.cargo/config.toml`
   - `CLANG_PATH`
   - `LIBCLANG_PATH`
   - `OPENCV_LINK_PATHS`
   - `OPENCV_INCLUDE_PATHS`
2. `src-tauri/build.rs`
   - `OPENCV_DLL`
3. `src-tauri/tauri.conf.json`
   - `bundle.resources` 中 OpenCV DLL 的来源路径

当前链接库名称为：

```text
opencv_world4120
```

如果使用其他 OpenCV 版本，还需要同步修改库名称和 DLL 文件名。构建脚本会把 OpenCV DLL 复制到 Cargo 输出目录，安装包也会包含该运行库。

## 构建与打包

构建前端：

```powershell
npm.cmd run build
```

运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

构建所有 Tauri 默认产物：

```powershell
npm.cmd run tauri build
```

只构建 Windows NSIS 安装包：

```powershell
npm.cmd run tauri build -- --bundles nsis
```

默认输出位置：

```text
src-tauri\target\release\
src-tauri\target\release\bundle\nsis\
```

安装包通常命名为：

```text
M App_0.1.0_x64-setup.exe
```

## 项目结构

```text
M_APP/
├─ scripts/                 Codex 状态匹配模板与调试脚本
├─ src/
│  ├─ App.tsx               主界面、数据状态和交互逻辑
│  ├─ styles.css            全局视觉系统、布局与动画
│  └─ main.tsx              React 入口
├─ src-tauri/
│  ├─ icons/                应用与安装包图标
│  ├─ src/lib.rs            文件保存、托盘、通知窗口与状态检测
│  ├─ build.rs              OpenCV 运行库复制
│  ├─ Cargo.toml            Rust 依赖
│  └─ tauri.conf.json       Tauri 窗口与打包配置
├─ .cargo/config.toml       Clang 与 OpenCV 本机路径
├─ package.json             前端依赖和命令
└─ README.md
```

## 常见问题

### 关闭窗口后，任务管理器里为什么还有 M App？

这是关闭到托盘功能。请从托盘菜单点击“退出”完全结束程序。

### 关闭状态检测后，为什么状态灯不见了？

这是预期行为。检测开关同时控制后台检测和悬浮状态灯；重新开启后状态灯会恢复。

### 状态检测为什么识别不到？

依次检查：

1. Codex 或终端目标窗口是否正在运行。
2. 状态检测是否开启。
3. 当前分辨率和 Windows 缩放是否填写正确。
4. 状态检测页是否显示命中截图。
5. `scripts/` 中四张模板图片是否存在。
6. OpenCV DLL 是否随程序正确加载。

### 打包时报 OpenCV 或 libclang 错误怎么办？

检查 `.cargo/config.toml`、`src-tauri/build.rs` 和 `src-tauri/tauri.conf.json` 中的绝对路径，确认版本号、目录和 DLL 名称一致。

### 为什么提醒没有出现？

- 确认事项设置了将来的提醒时间。
- 确认 Windows 已允许 M App 发送通知。
- 确认应用仍在运行或托盘中。
- 已完成事项不会触发提醒。

### 为什么网页预览不能保存到 `app-data.json`？

网页预览没有 Tauri 后端，无法访问桌面文件接口。请使用 `npm.cmd run tauri dev` 测试保存、托盘、通知和状态检测。

## 技术栈

- Tauri 2
- React 18
- TypeScript 5
- Vite 5
- Rust
- OpenCV 4.12
- `screenshots` 与 Windows `PrintWindow`
- `tauri-plugin-notification`
- `emoji-picker-react`
- `lucide-react`

## 参与开发

欢迎通过 [GitHub Issues](https://github.com/mrchicken134/M_APP/issues) 报告问题或提出功能建议。提交代码前建议运行：

```powershell
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
```

---

<a id="english"></a>

# M_APP

[中文](#m_app) | **English**

M_APP is a local-first Windows desktop workspace built with **Tauri 2, React, TypeScript, Rust, and OpenCV**. It combines a calendar, task manager, workflow queue, habits, temporary tasks, reminders, tray integration, and Codex activity detection.

## Highlights

- Local JSON persistence without an account or cloud service.
- Month calendar and a weekly `0–24` hour timeline.
- Unified calendar events and tasks.
- Smart lists, custom lists, priorities, reminders, subtasks, and recurrence.
- Drag-and-drop workflow queue with before/after insertion feedback.
- Waiting area that returns cards to the head or tail at a scheduled time.
- Windows notifications and close-to-tray behavior.
- Always-on-top Codex traffic-light window.
- Codex Desktop and CLI template detection with configurable resolution and DPI.

## Pages

### Calendar

- Select dates in month view and double-click to open the detailed week timeline.
- Timed tasks are positioned by their actual start and end time.
- Emoji labels can be dragged onto month cells.
- The right panel edits the selected day's tasks and labels.

### Tasks

- Smart lists: Today, Upcoming, Important, Completed, and All.
- Custom lists with icons and colors.
- Three time modes: start/end, start only, and no time.
- Optional date, priority, reminder, recurrence, subtasks, details, and Emoji icon.
- Double-click a dated task to open its date in the calendar.

### Workflow

- Drag tasks, temporary tasks, or habits from the right-side source panels into the left queue.
- Drop on the upper or lower half of a card to insert before or after it.
- Workflow copies can be removed without deleting their source.
- Completing a task updates the original task; completing a temporary task removes its source; completing a habit only removes the workflow card.

### Waiting Area

- Wait for a duration or until an exact date and time.
- Return the card to the workflow head or tail.
- A pulsing flag appears in the floating status window when a card returns; click the window to acknowledge it.

### Codex Detector

- Red: working.
- Yellow: waiting for approval or detector error.
- Green: idle or completed.
- Detects the Codex Desktop stop button and Codex CLI `Ready`, `Working`, and approval prompts.
- Captures Codex/terminal process windows and uses OpenCV normalized template matching.
- Polls every second and uses consecutive-frame stabilization.
- Supports multiple displays and configurable template/screen resolution and scaling.
- The detector page shows the matched crop, location, type, and confidence.
- Turning detection off also hides the floating status window and persists the disabled state.

## Install and Use

Run the generated NSIS installer and launch **M App** from the Start menu or desktop shortcut. Installer users do not need Node.js, Rust, OpenCV, or the source tree.

Closing the main window keeps M App running in the system tray. Use **Quit** from the tray menu to terminate it completely.

Application data is normally stored at:

```text
C:\Users\<UserName>\AppData\Roaming\com.mapp.desktop\app-data.json
```

Back up this file while M App is not running to preserve tasks, lists, labels, habits, temporary tasks, workflow cards, and waiting cards.

## Development

Requirements:

- Windows 10/11 x64
- Node.js 24 LTS
- Rust stable with the MSVC target
- Visual Studio Build Tools with Desktop development with C++
- OpenCV 4.12 x64
- LLVM/Clang and `libclang`

```powershell
git clone https://github.com/mrchicken134/M_APP.git
cd M_APP
npm.cmd install
npm.cmd run tauri dev
```

The repository currently contains machine-specific OpenCV and Clang paths in:

- `.cargo/config.toml`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`

Update those paths if your dependencies are installed elsewhere.

Build and test:

```powershell
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri build -- --bundles nsis
```

The NSIS installer is generated under:

```text
src-tauri\target\release\bundle\nsis\
```

## Limitations

- Windows is the supported desktop target.
- No cloud sync, account system, or multi-device collaboration.
- Screen detection depends on Windows being able to capture the target window.
- CLI history containing an old, fully visible status string can still create an ambiguous template match.
- Changing terminal font, color theme, weight, or antialiasing may reduce matching confidence.

Issues and feature requests are welcome in [GitHub Issues](https://github.com/mrchicken134/M_APP/issues).

# M_APP

Language: **中文** | [English](#english)

M_APP 是一个使用 **Tauri 2 + React + TypeScript** 构建的 Windows 桌面个人工作台。它把日历、事项管理、工作流、习惯、临时任务、系统提醒和 Codex 工作状态检测整合在一个本地优先应用中。

应用不需要账号或云服务，主要数据保存在本机 JSON 文件中。界面面向高频桌面操作设计，支持紧凑布局、拖拽交互、系统托盘和统一动效。

## 功能

### 日历

- 月视图显示完整日期网格，相邻月份日期以弱化样式显示。
- 单击日期切换选中状态，双击日期进入详细周视图。
- 详细模式使用 `0-24` 小时时间轴，事项按实际开始和结束时间定位。
- 同一时间段内的多个事项会自动分栏，尽量避免重叠。
- 月视图日期格显示未完成事项点，最多显示 5 个。
- 日期格可以显示拖入的 Emoji 标签。
- 日历右侧可查看当天事项、编辑详情、完成或删除事项。
- 月视图与周视图之间保留连贯的展开、收缩和滑动动画。

### 日期标签

- 标签与事项清单相互独立，用于标记日期状态。
- 顶部标签栏使用纯图标布局，支持新增和删除模式。
- 标签图标可从完整 Emoji 选择器中挑选。
- 标签可拖到月视图日期格，拖动时显示跟随预览和目标高亮。
- 右侧当天标签栏可以添加或删除选中日期的标签。
- 标签定义和日期绑定关系都会持久化保存。

### 事项列表

- 日历事项与待办事项使用统一数据模型。
- 智能清单包括：今天、即将到来、重要、已完成、全部。
- 支持自定义清单及清单名称、图标和颜色。
- 事项字段包括日期、时间类型、开始/结束时间、标题、详情、Emoji 图标、优先级、提醒、循环、子任务、完成状态和所属清单。
- 时间类型支持：开始和结束时间、只有开始时间、无时间。
- 单击事项选择并编辑，双击事项跳转到对应日历日期。
- 支持搜索、排序、拖动排序、完成/取消完成和删除动画。
- 简单循环支持每日、每周、每月；完成后自动生成下一次事项。

### 工作流

- 左侧是独立工作流队列，默认为空。
- 右侧同时显示事项、临时任务和习惯三个来源区。
- 从右侧拖入左侧时会复制为独立工作流卡片，不与来源条目同步删除。
- 工作流卡片支持上下拖动自定义排序。
- 事项卡片显示时间；所有工作流卡片均可单独设置优先级，并按优先级改变边框和背景颜色。
- 点击工作流卡片的完成圆圈时：
  - 事项：标记原事项为完成，并移出工作流。
  - 临时任务：删除原临时任务，并移出工作流。
  - 习惯：只移出本次工作流，保留习惯来源。
- 习惯和临时任务只有名称、详情和 Emoji 图标；默认使用紧凑卡片，双击后打开编辑窗口。
- 删除右侧来源条目不会删除已经复制到左侧的工作流卡片。

### 等待区

- 工作流左侧下方包含等待区。
- 将来源卡片或现有工作流卡片拖入等待区时，会先打开设置窗口。
- 可以按等待分钟数或具体结束时间设置等待。
- 到期后可选择加入工作流队头或队尾。
- 等待卡片保留图标和优先级，并支持修改等待时间和加入位置。

### Codex 状态检测

- 应用启动时可显示独立的置顶红绿灯悬浮窗。
- 红色表示工作中，黄色表示等待审批或检测异常，绿色表示完成/空闲。
- 悬浮窗尺寸为 `420 x 75`，无边框、可拖动、跳过任务栏。
- 状态检测页面可以开启或关闭检测，并记忆下次启动设置。
- 内置 Rust 后台线程会截取所有显示器并匹配 Codex 工作按钮模板。
- 支持多显示器和不同 DPI 缩放比例，检测时会尝试多组模板尺寸。
- 单个显示器截屏失败不会阻止其他显示器继续检测。
- 检测模板位于 `scripts/codex-working-button.png`。

### 提醒、托盘与本地保存

- 支持 Windows 系统通知提醒。
- 关闭主窗口时应用隐藏到系统托盘，而不是直接退出。
- 托盘菜单包含“打开”和“退出”。
- 桌面数据保存在 Tauri 应用数据目录下的 `app-data.json`。
- 网页预览无法调用 Tauri 后端时，会使用浏览器本地存储作为预览兜底。

Windows 数据路径通常类似：

```text
C:\Users\<UserName>\AppData\Roaming\com.mapp.desktop\app-data.json
```

### 界面与动画

- 统一的现代桌面工具视觉系统：浅灰工作区、石墨侧栏和语义化状态颜色。
- 日历、事项、工作流、设置页和弹窗使用一致的表面、边框、阴影与焦点反馈。
- 页面、列表、完成操作、拖拽、弹窗和提示均带有轻量动画。
- 支持系统 `prefers-reduced-motion` 设置，可关闭非必要动画。
- 默认窗口尺寸为 `1600 x 900`，最小尺寸为 `900 x 600`。

## 技术栈

- Tauri 2
- React 18
- TypeScript
- Vite
- Rust
- `tauri-plugin-notification`
- `emoji-picker-react`
- `lucide-react`
- `screenshots` 与 `image` Rust crates

## 开发与构建

安装依赖：

```powershell
npm.cmd install
```

启动网页开发服务器：

```powershell
npm.cmd run dev
```

启动桌面开发模式：

```powershell
npm.cmd run tauri dev
```

构建前端资源：

```powershell
npm.cmd run build
```

构建桌面应用：

```powershell
npm.cmd run tauri build
```

只构建 Windows NSIS 安装包：

```powershell
npm.cmd run tauri build -- --bundles nsis
```

输出目录：

```text
src-tauri/target/release/
src-tauri/target/release/bundle/nsis/
```

## 说明

- 当前版本不包含云同步、账号系统或多设备协作。
- 完全退出应用请使用托盘菜单中的“退出”。
- Windows 可能缓存旧的 EXE 图标；可通过重命名文件或刷新图标缓存确认新图标。
- `codex-status.json` 和 `codex-detector-settings.json` 是本机运行状态文件，不应提交到仓库。

---

<a id="english"></a>

# M_APP

Language: [中文](#m_app) | **English**

M_APP is a local-first Windows desktop workspace built with **Tauri 2, React, TypeScript, and Rust**. It combines a calendar, task manager, workflow queue, habits, temporary tasks, reminders, tray behavior, and Codex activity detection in one application.

## Features

### Calendar and labels

- Month calendar with adjacent-month dates, task dots, selectable dates, and Emoji labels.
- Detailed week timeline using a `0-24` hour scale and real event positioning.
- Automatic side-by-side layout for overlapping timed tasks.
- Animated month/week transitions and drag-and-drop date labels.

### Task manager

- Smart lists: Today, Upcoming, Important, Completed, and All.
- Custom lists with editable names, icons, and colors.
- Tasks support dates, three time modes, priorities, reminders, recurrence, subtasks, Emoji icons, completion, and list ownership.
- Search, sorting, manual reordering, calendar navigation, completion animations, and daily/weekly/monthly recurrence.

### Workflow

- Empty-by-default workflow queue populated by dragging tasks, temporary tasks, or habits from the source panels.
- Independent workflow card copies with custom ordering and priority colors.
- Task cards show their time and complete the original task when checked.
- Completing a temporary task removes its source; completing a habit only removes the current workflow card.
- Habits and temporary tasks use compact cards and open an editor on double-click.

### Waiting area

- Drag cards into a waiting area and configure either a duration or an exact end time.
- When the wait expires, the card can be inserted at the head or tail of the workflow queue.

### Codex activity detector

- Always-on-top `420 x 75` traffic-light status window.
- Red for working, yellow for approval/error, and green for idle/completed.
- Built-in Rust screen capture and template matching across multiple displays and DPI scales.
- Persistent detector on/off setting in the main application.

### Desktop integration

- Windows notifications and reminder polling.
- Close-to-tray behavior with Open and Quit tray actions.
- Local JSON persistence without an account or cloud dependency.
- Unified compact desktop UI with responsive layouts, drag feedback, modal animation, and reduced-motion support.

## Development

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run tauri dev
npm.cmd run build
npm.cmd run tauri build -- --bundles nsis
```

The NSIS installer is generated under:

```text
src-tauri/target/release/bundle/nsis/
```

## Notes

- The project currently has no cloud sync or account system.
- Closing the main window hides the app to the tray; use Quit from the tray menu to terminate it.
- Runtime detector JSON files are intentionally excluded from Git.

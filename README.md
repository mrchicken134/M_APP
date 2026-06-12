# M_APP

🌏 Language: **中文** | [English](#english)

M_APP 是一个基于 **Tauri + React + TypeScript** 构建的 Windows 桌面个人工作台。它把日历、事项管理、日期标签、系统提醒和托盘后台运行整合在一起，适合用来安排每日任务、查看时间分布、管理清单和记录日期状态。

应用是本地优先的：不需要账号，不依赖云同步，数据保存在本机 JSON 文件中。打开即用，安静但够灵活。✨

## 功能亮点

### 📅 日历

- 月视图显示完整日期网格，并用灰色显示相邻月份日期。
- “今天”高亮会在跨天后自动刷新，不需要重启应用。
- 点击日期可选中当天，并在右侧查看当天事项。
- 双击日期可进入详细模式。
- 详细模式是周时间轴：左侧为 `0-24` 点，右侧按周日到周六分列。
- 有开始和结束时间的事项会按真实时间位置显示，例如 `00:30 - 01:30` 会从 0 点和 1 点刻度中间开始，到 1 点和 2 点刻度中间结束。
- 持续时间大于 1 小时的事项显示图标、标题和时间；较短事项只显示图标，避免文字挤在一起。
- 同一天内时间重叠的事项会尽量自动并排排列。
- 月视图日期格会显示未完成事项点，最多显示 5 个点。

### 🏷️ 日期标签

- 标签和待办清单是两套概念：标签用于标记日期，清单用于归类事项。
- 顶部标签栏只显示图标，并带有新增和删除控制。
- 可以用 emoji 创建自定义标签。
- 标签可以拖拽到月视图日期格上。
- 日期格会在数字上方显示标签图标。
- 右侧栏可以查看和管理当天标签。
- 删除模式下标签右上角显示删除按钮；当天标签删完后会自动退出删除模式。

### ✅ 事项列表

- 日历事项和待办事项使用统一数据模型。
- 内置智能清单：
  - 今天
  - 即将到来
  - 重要
  - 已完成
  - 全部
- 支持自定义清单，并可编辑清单名称、图标和颜色。
- 事项支持字段：
  - 日期
  - 时间类型
  - 开始时间
  - 结束时间
  - 标题
  - 详情
  - emoji 图标
  - 优先级
  - 提醒时间
  - 循环规则
  - 子任务
  - 完成状态
  - 所属清单
- 时间类型包括：
  - 开始 + 结束时间
  - 只有开始时间
  - 无时间
- 单击事项可在右侧编辑详情。
- 在事项列表中双击事项可跳转到日历对应日期。
- 在日历中选择事项也可以跳转回事项列表。
- 简单循环事项支持 daily、weekly、monthly，完成后会生成下一次事项。

### 🔔 提醒与系统托盘

- 支持系统通知提醒。
- 应用运行时会定时检查提醒事项。
- 点击窗口关闭按钮时，应用默认隐藏到系统托盘，而不是直接退出。
- 托盘菜单包含：
  - 打开
  - 退出
- 托盘图标使用打包后的应用图标。

### 💾 本地数据保存

桌面版数据会保存到 Tauri 应用数据目录下的 `app-data.json`。

Windows 上通常类似：

```text
C:\Users\<UserName>\AppData\Roaming\com.mapp.desktop\app-data.json
```

保存内容包括：

- 事项
- 自定义清单
- 日期标签
- 标签和日期的绑定关系
- 已触发提醒记录

网页预览或开发环境无法访问 Tauri 后端时，会使用浏览器本地存储能力作为预览兜底。

### ✨ 动画与交互

- 月份切换动画。
- 日期选中动画。
- 标签新增、删除、拖拽和落入日期格动画。
- 事项新增、删除、完成和清单切换动画。
- 拖拽标签时有图标跟随效果。
- 详细模式和月视图之间有展开/收起过渡。
- 默认窗口大小为 `1600 x 900`。

## 技术栈

- Tauri 2
- React 18
- TypeScript
- Vite
- Rust 后端命令用于本地数据读写
- Tauri notification plugin
- Tauri tray integration
- `emoji-picker-react`
- `lucide-react`

## 项目结构

```text
M_APP/
|-- src/
|   |-- App.tsx
|   |-- main.tsx
|   `-- styles.css
|-- src-tauri/
|   |-- src/
|   |   |-- lib.rs
|   |   `-- main.rs
|   |-- icons/
|   |-- capabilities/
|   |-- Cargo.toml
|   `-- tauri.conf.json
|-- package.json
|-- package-lock.json
|-- tsconfig.json
`-- vite.config.ts
```

## 开发

安装依赖：

```powershell
npm.cmd install
```

只启动网页开发服务器：

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

打包桌面应用：

```powershell
npm.cmd run tauri build
```

只打包 Windows NSIS 安装包：

```powershell
npm.cmd run tauri build -- --bundles nsis
```

生成的安装包位于：

```text
src-tauri/target/release/bundle/nsis/
```

生成的 exe 位于：

```text
src-tauri/target/release/
```

## 图标生成

可以从 PNG 源图重新生成 Tauri 图标：

```powershell
npm.cmd run tauri icon "图标.png"
```

生成结果位于：

```text
src-tauri/icons/
```

## 说明

- 本项目是本地优先应用，不包含云同步。
- 当前没有账号系统。
- 默认关闭窗口会隐藏到托盘；如果要完全退出，请使用托盘菜单中的“退出”。
- Windows 可能缓存旧 exe 图标。如果新打包的 exe 仍显示旧图标，可以改名、重启资源管理器或刷新图标缓存。

---

<a id="english"></a>

# M_APP

🌏 Language: [中文](#m_app) | **English**

M_APP is a Windows desktop personal workspace built with **Tauri + React + TypeScript**. It combines a calendar, task manager, date labels, reminders, and tray background behavior into one lightweight local application.

The app is designed for personal daily planning: month overview, week timeline details, full task editing, custom lists, emoji icons, and local JSON persistence without requiring an account or cloud service. ✨

## Features

### 📅 Calendar

- Month calendar with adjacent previous/next month dates shown in gray.
- Today highlighting updates automatically after midnight while the app is running.
- Click a date to select it and view that day's tasks.
- Double-click a date to enter detailed week mode.
- Detailed mode shows a week timeline with a `0-24` hour scale.
- Timed tasks are placed by real start/end time. For example, a task from `00:30` to `01:30` starts halfway between the 0 and 1 hour marks and ends halfway between the 1 and 2 hour marks.
- Tasks longer than one hour display icon, title, and time. Short tasks only show the icon to avoid cramped text.
- Overlapping tasks in the same day column are automatically arranged side by side as much as possible.
- Month cells show up to five dots for unfinished tasks on that date.

### 🏷️ Date Labels

- Calendar labels are separate from task lists.
- The top label bar contains icon-only labels plus add and delete controls.
- Labels can be created with emoji icons.
- Labels can be dragged onto month-view date cells.
- Date cells show label icons above the date number.
- The right sidebar can show and manage labels assigned to the selected date.
- Delete mode shows delete buttons and exits automatically when all labels are removed.

### ✅ Task Manager

- Calendar events and tasks use one unified data model.
- Built-in smart lists:
  - Today
  - Upcoming
  - Important
  - Completed
  - All
- Custom lists with editable name, icon, and color.
- Task fields:
  - Date
  - Time type
  - Start time
  - End time
  - Title
  - Detail
  - Emoji icon
  - Priority
  - Reminder time
  - Recurrence
  - Subtasks
  - Completion state
  - List ownership
- Time types:
  - Start and end time
  - Start time only
  - No time
- Single-click a task to edit details.
- Double-click a task in the task list to jump to its calendar date.
- Calendar task cards can jump back to the task list.
- Simple recurrence supports daily, weekly, and monthly next-task creation.

### 🔔 Reminders And Tray

- System notifications are supported.
- Reminder checks run while the app is open.
- Closing the window hides the app to the system tray instead of exiting.
- Tray menu includes:
  - Open
  - Quit
- The tray icon uses the packaged application icon.

### 💾 Local Data Storage

The desktop app stores user data locally in the Tauri application data directory as `app-data.json`.

On Windows, the path is usually similar to:

```text
C:\Users\<UserName>\AppData\Roaming\com.mapp.desktop\app-data.json
```

Saved data includes:

- Tasks
- Custom lists
- Calendar labels
- Date label assignments
- Already-triggered reminder IDs

In web preview or development mode without Tauri backend access, the app falls back to browser local storage behavior where applicable.

### ✨ Visual And Interaction Details

- Animated month switching.
- Animated date selection.
- Animated label creation, deletion, dragging, and placement.
- Animated task creation, deletion, completion, and list switching.
- Drag preview when dragging labels.
- Smooth transition between month view and detailed week mode.
- Initial desktop window size is `1600 x 900`.

## Tech Stack

- Tauri 2
- React 18
- TypeScript
- Vite
- Rust backend commands for local data read/write
- Tauri notification plugin
- Tauri tray integration
- `emoji-picker-react`
- `lucide-react`

## Development

Install dependencies:

```powershell
npm.cmd install
```

Run web dev server only:

```powershell
npm.cmd run dev
```

Run desktop app in development mode:

```powershell
npm.cmd run tauri dev
```

Build frontend assets:

```powershell
npm.cmd run build
```

Build desktop application:

```powershell
npm.cmd run tauri build
```

Build only the NSIS Windows installer:

```powershell
npm.cmd run tauri build -- --bundles nsis
```

## Notes

- This project is local-first and does not include cloud sync.
- There is no account system.
- Closing the window does not exit the app by default; use the tray menu's Quit action to fully exit.
- Windows may cache old executable icons. If a newly built executable still shows an old icon, rename the executable or refresh the Windows icon cache.

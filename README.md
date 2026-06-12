# M_APP

M_APP is a Windows desktop personal workspace built with Tauri, React, and TypeScript. It combines a calendar, task manager, date labels, reminders, and tray background behavior into one lightweight local application.

The app is designed for personal daily planning: month-level overview, week timeline details, full task editing, custom lists, emoji icons, and local JSON persistence without requiring an account or cloud service.

## Features

### Calendar

- Month calendar with adjacent previous/next month dates shown in gray.
- Today highlighting updates automatically after midnight while the app is running.
- Click a date to select it and view that day's tasks.
- Double-click a date to switch to detailed week mode.
- Detailed mode shows a week timeline with a 0-24 hour time scale.
- Timed tasks are placed by real start/end time. For example, a task from `00:30` to `01:30` starts halfway between the 0 and 1 hour marks and ends halfway between the 1 and 2 hour marks.
- Tasks longer than one hour display icon, title, and time. Short tasks only show the icon to avoid cramped overlapping text.
- Overlapping tasks in the same day column are automatically arranged side by side as much as possible.
- Month cells show up to five dots for unfinished tasks on that date.

### Date Labels

- Calendar labels are separate from task lists.
- The top label bar contains icon-only labels plus add and delete controls.
- Labels can be created with emoji icons.
- Labels can be dragged onto month-view date cells.
- Date cells show label icons above the date number.
- The right sidebar can show and manage labels assigned to the selected date.
- Delete mode shows delete buttons for labels and exits automatically when all labels are removed.

### Task Manager

- Unified task/event model used by both the calendar and task list.
- Smart lists:
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
  - Range: start time and end time
  - Start only: start time without end time
  - No time
- Single-click a task to edit details.
- Double-click a task in the task list to jump to its calendar date.
- Calendar task cards can also jump back to the task list.
- Completing a recurring task creates the next occurrence for simple daily, weekly, or monthly recurrence.

### Reminders And Tray

- System notification support through Tauri notification plugin.
- Reminder checks run while the app is open.
- Closing the window hides the app to the system tray instead of exiting, so reminders can continue.
- Tray menu includes:
  - Open
  - Quit
- Tray icon uses the packaged application icon.

### Local Data Storage

The desktop app stores user data locally in the Tauri application data directory as `app-data.json`.

On Windows, the path is usually similar to:

```text
C:\Users\<UserName>\AppData\Roaming\com.mapp.desktop\app-data.json
```

The saved data includes:

- Tasks
- Custom lists
- Calendar labels
- Date label assignments
- Already-triggered reminder IDs

In web preview or development mode without Tauri backend access, the app falls back to browser local storage behavior where applicable.

### Visual And Interaction Details

- Animated month switching.
- Animated date selection.
- Animated label creation, deletion, and placement.
- Animated task creation, deletion, completion, and list switching.
- Drag preview when dragging labels.
- Responsive layout for calendar and task views.
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

## Project Structure

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

## Development

Install dependencies:

```powershell
npm.cmd install
```

Run the web dev server only:

```powershell
npm.cmd run dev
```

Run the desktop app in development mode:

```powershell
npm.cmd run tauri dev
```

Build frontend assets:

```powershell
npm.cmd run build
```

Build the desktop application:

```powershell
npm.cmd run tauri build
```

Build only the NSIS Windows installer:

```powershell
npm.cmd run tauri build -- --bundles nsis
```

The generated Windows installer is written under:

```text
src-tauri/target/release/bundle/nsis/
```

The generated executable is written under:

```text
src-tauri/target/release/
```

## Icon Generation

The Tauri icon set can be regenerated from a PNG source image:

```powershell
npm.cmd run tauri icon "图标.png"
```

The generated icons are stored in:

```text
src-tauri/icons/
```

## Notes

- This project is local-first and does not include cloud sync.
- There is no account system.
- Closing the window does not exit the app by default; use the tray menu's Quit action to fully exit.
- Windows may cache old executable icons. If a newly built executable still shows an old icon, rename the executable or refresh the Windows icon cache.

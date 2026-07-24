import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import {
  AppWindow,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  Inbox,
  ListTodo,
  LocateFixed,
  Plus,
  Search,
  Star,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "calendar" | "events" | "workflow" | "codex";
type CalendarMode = "month" | "detail";
type SlideDirection = "up" | "down";
type Priority = "none" | "low" | "medium" | "high";
type Recurrence = "none" | "daily" | "weekly" | "monthly";
type TimeKind = "range" | "start" | "none";
type SmartListId = "today" | "upcoming" | "important" | "completed" | "all";
type SelectedListId = SmartListId | string;
type CodexStatusValue = "working" | "pending_approval" | "done" | "idle";

type CodexStatusData = {
  status?: CodexStatusValue;
  message?: string;
  updatedAt?: string;
  match?: {
    kind: string;
    label: string;
    screenIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
    confidence?: number;
    scale?: number;
    consecutiveFrames?: number;
  };
};

type CodexDetectorSettings = {
  enabled: boolean;
  templateWidth: number;
  templateHeight: number;
  templateScalePercent: number;
  screenWidth: number;
  screenHeight: number;
  screenScalePercent: number;
  updatedAt?: string;
};

type WorkflowReturnAlert = {
  id?: string;
  title?: string;
  message?: string;
  count?: number;
  createdAt?: string;
  acknowledged?: boolean;
};

const workflowSourceDragMime = "application/x-m-app-workflow-source";
const workflowCardDragMime = "application/x-m-app-workflow-card";

type CalendarDay = {
  date: Date;
  day: number;
  inCurrentMonth: boolean;
};

type Subtask = {
  id: string;
  title: string;
  completed: boolean;
};

type TaskEvent = {
  id: string;
  date: string;
  timeKind: TimeKind;
  startTime: string;
  endTime: string;
  title: string;
  detail: string;
  icon: string;
  completed: boolean;
  completedAt: string | null;
  priority: Priority;
  listId: string;
  subtasks: Subtask[];
  reminderAt: string;
  recurrence: Recurrence;
  createdAt: string;
  updatedAt: string;
  order: number;
};

type TaskList = {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
};

type CalendarTag = {
  id: string;
  name: string;
  icon: string;
};

type WorkflowItem = {
  id: string;
  name: string;
  detail: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  order: number;
};

type WorkflowSourceKind = "task" | "habit" | "temp";
type WorkflowDropTarget = "queue" | "waiting" | "";
type WorkflowInsertPosition = "before" | "after";

type WorkflowCard = {
  id: string;
  sourceKind: WorkflowSourceKind;
  sourceId: string;
  title: string;
  detail: string;
  icon: string;
  timeLabel: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  order: number;
};

type WaitingWorkflowCard = WorkflowCard & {
  waitUntil: string;
  insertPosition: "head" | "tail";
};

type PendingWaitingCard = {
  card: WorkflowCard;
  sourceWorkflowCardId?: string;
};

type WorkflowInsertTarget =
  | { position: "head" | "tail" }
  | { targetId: string; position: WorkflowInsertPosition };

type WorkflowEditorTarget = {
  sourceKind: WorkflowSourceKind;
  sourceId: string;
};

type AppData = {
  schemaVersion: number;
  tasks: TaskEvent[];
  lists: TaskList[];
  tags: CalendarTag[];
  tagAssignments: Record<string, string[]>;
  habits: WorkflowItem[];
  tempTasks: WorkflowItem[];
  workflowCards: WorkflowCard[];
  waitingWorkflowCards: WaitingWorkflowCard[];
  notifiedReminderIds: string[];
};

type EmojiTarget =
  | { type: "event" }
  | { type: "tag"; tagId: string }
  | { type: "newTag" }
  | { type: "list"; listId: string }
  | { type: "workflow"; kind: "habit" | "temp"; itemId: string };
type TagPickerTarget = "global" | "day";

const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];
const eventIcons = ["📌", "✅", "🕘", "🗓️", "💡", "☎️", "📚", "💻", "🎯"];
const priorityLabels: Record<Priority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高"
};
const recurrenceLabels: Record<Recurrence, string> = {
  none: "不循环",
  daily: "每天",
  weekly: "每周",
  monthly: "每月"
};
const smartLists: Array<{
  id: SmartListId;
  name: string;
  icon: typeof Inbox;
}> = [
  { id: "today", name: "今天", icon: CalendarDays },
  { id: "upcoming", name: "即将到来", icon: Clock },
  { id: "important", name: "重要", icon: Star },
  { id: "completed", name: "已完成", icon: CheckCircle2 },
  { id: "all", name: "全部", icon: Inbox }
];

const defaultCodexDetectorSettings: CodexDetectorSettings = {
  enabled: true,
  templateWidth: 2560,
  templateHeight: 1440,
  templateScalePercent: 125,
  screenWidth: 2560,
  screenHeight: 1440,
  screenScalePercent: 125
};

const codexResolutionPresets = [
  { label: "2560 × 1440", width: 2560, height: 1440 },
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "3840 × 2160", width: 3840, height: 2160 },
  { label: "自定义", width: 0, height: 0 }
];

const codexScalePresets = [100, 125, 150, 175, 200];

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromParts(date: { year: number; month: number; day: number }) {
  return new Date(date.year, date.month, date.day);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function addMonths(date: Date, count: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function nextDateForRecurrence(dateKey: string, recurrence: Recurrence) {
  if (!dateKey) {
    return "";
  }

  const date = new Date(`${dateKey}T00:00:00`);
  if (recurrence === "daily") {
    date.setDate(date.getDate() + 1);
  } else if (recurrence === "weekly") {
    date.setDate(date.getDate() + 7);
  } else if (recurrence === "monthly") {
    return formatDateKey(addMonths(date, 1));
  }
  return formatDateKey(date);
}

function buildReminderValue(task: TaskEvent) {
  if (!task.reminderAt) {
    return "";
  }
  return task.reminderAt.slice(0, 16);
}

function toDateTimeInputValue(value: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeInputValue(value: string) {
  if (!value) {
    return "";
  }
  return new Date(value).toISOString();
}

function inferTimeKind(task: Partial<TaskEvent>): TimeKind {
  if (task.timeKind) {
    return task.timeKind;
  }
  if (task.startTime && task.endTime) {
    return "range";
  }
  if (task.startTime) {
    return "start";
  }
  return "none";
}

function normalizeTimeFields(task: Pick<TaskEvent, "timeKind" | "startTime" | "endTime">) {
  if (task.timeKind === "none") {
    return { startTime: "", endTime: "" };
  }
  if (task.timeKind === "start") {
    return { startTime: task.startTime || "09:00", endTime: "" };
  }
  return {
    startTime: task.startTime || "09:00",
    endTime: task.endTime || "10:00"
  };
}

function formatTaskTime(task: TaskEvent) {
  if (task.timeKind === "none") {
    return "无时间";
  }
  if (task.timeKind === "start") {
    return task.startTime || "未设时间";
  }
  if (!task.startTime && !task.endTime) {
    return "未设时间段";
  }
  return `${task.startTime || "?"} - ${task.endTime || "?"}`;
}

function formatTaskDate(task: Pick<TaskEvent, "date">) {
  return task.date || "无日期";
}

function compareTaskDate(a: Pick<TaskEvent, "date">, b: Pick<TaskEvent, "date">) {
  return (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31");
}

function isTaskDateInRange(task: Pick<TaskEvent, "date">, startKey: string, endKey: string) {
  return Boolean(task.date && task.date >= startKey && task.date <= endKey);
}

function compareTaskTime(a: TaskEvent, b: TaskEvent) {
  const rank: Record<TimeKind, number> = { range: 0, start: 1, none: 2 };
  const rankCompare = rank[a.timeKind] - rank[b.timeKind];
  if (rankCompare !== 0) {
    return rankCompare;
  }
  return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
}

const timelineHourHeight = 54;

function timeToMinutes(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return Math.min(24 * 60, Math.max(0, hour * 60 + minute));
}

function getTimelineStyle(task: TaskEvent) {
  const start = timeToMinutes(task.startTime || "00:00");
  const end =
    task.timeKind === "range" && task.endTime
      ? timeToMinutes(task.endTime)
      : start + 30;
  const duration = Math.max(20, end - start);

  return {
    top: `${(start / 60) * timelineHourHeight}px`,
    height: `${(duration / 60) * timelineHourHeight}px`
  };
}

function getTimelineBounds(task: TaskEvent) {
  const start = timeToMinutes(task.startTime || "00:00");
  const end =
    task.timeKind === "range" && task.endTime
      ? timeToMinutes(task.endTime)
      : start + 30;

  return {
    start,
    end: Math.max(start + 20, end)
  };
}

function getTimelineDensityClass(task: TaskEvent) {
  if (task.timeKind === "none") {
    return "normal";
  }

  const { start, end } = getTimelineBounds(task);
  const duration = end - start;

  return duration > 60 ? "normal" : "icon-only";
}

function layoutTimelineTasks(tasks: TaskEvent[]) {
  const timedTasks = tasks
    .filter((task) => task.timeKind !== "none")
    .map((task) => ({ task, ...getTimelineBounds(task) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const layouts = new Map<string, Record<string, string | number>>();
  let cluster: typeof timedTasks = [];
  let clusterEnd = -1;

  function flushCluster() {
    if (cluster.length === 0) {
      return;
    }

    const columnEnds: number[] = [];
    const assigned = cluster.map((item) => {
      const column = columnEnds.findIndex((end) => end <= item.start);
      const resolvedColumn = column === -1 ? columnEnds.length : column;
      columnEnds[resolvedColumn] = item.end;
      return { ...item, column: resolvedColumn };
    });
    const columns = Math.max(1, columnEnds.length);

    assigned.forEach(({ task, column }) => {
      layouts.set(task.id, {
        ...getTimelineStyle(task),
        "--event-column": column,
        "--event-columns": columns
      });
    });

    cluster = [];
    clusterEnd = -1;
  }

  timedTasks.forEach((item) => {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      flushCluster();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  flushCluster();

  const noneTasks = tasks.filter((task) => task.timeKind === "none");
  noneTasks.forEach((task, index) => {
    layouts.set(task.id, {
      top: `${6 + index * 42}px`,
      height: "38px",
      "--event-column": 0,
      "--event-columns": 1
    });
  });

  return layouts;
}

async function notifyTask(task: TaskEvent) {
  try {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }
    if (permissionGranted) {
      sendNotification({
        title: "M App 待办提醒",
        body: `${task.icon} ${task.title}${
          task.timeKind !== "none" ? ` · ${formatTaskTime(task)}` : ""
        }`
      });
      return;
    }
  } catch {
    // Browser fallback below keeps dev mode usable.
  }

  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("M App 待办提醒", {
        body: `${task.icon} ${task.title}${
          task.timeKind !== "none" ? ` · ${formatTaskTime(task)}` : ""
        }`
      });
    } else if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }
}

const initialLists: TaskList[] = [
  { id: "inbox", name: "收件箱", icon: "📥", color: "#2563eb", order: 1 },
  { id: "work", name: "工作", icon: "💻", color: "#0891b2", order: 2 },
  { id: "life", name: "生活", icon: "🌿", color: "#16a34a", order: 3 }
];

const initialTags: CalendarTag[] = [
  { id: "tag-work", name: "工作", icon: "💻" },
  { id: "tag-study", name: "学习", icon: "📚" },
  { id: "tag-life", name: "生活", icon: "☕" }
];

function createWorkflowItem(overrides: Partial<WorkflowItem> = {}): WorkflowItem {
  const timestamp = nowIso();
  return {
    id: createId("workflow"),
    name: "新条目",
    detail: "",
    icon: "📝",
    createdAt: timestamp,
    updatedAt: timestamp,
    order: Date.now(),
    ...overrides
  };
}

function createWorkflowCard(overrides: Partial<WorkflowCard> = {}): WorkflowCard {
  const timestamp = nowIso();
  return {
    id: createId("flow-card"),
    sourceKind: "task",
    sourceId: "",
    title: "新卡片",
    detail: "",
    icon: "📌",
    timeLabel: "",
    priority: "none",
    createdAt: timestamp,
    updatedAt: timestamp,
    order: Date.now(),
    ...overrides
  };
}

function createWaitingWorkflowCard(
  overrides: Partial<WaitingWorkflowCard> = {}
): WaitingWorkflowCard {
  return {
    ...createWorkflowCard(overrides),
    waitUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    insertPosition: "tail",
    ...overrides
  };
}

const initialHabits: WorkflowItem[] = [
  createWorkflowItem({
    id: "habit-1",
    name: "每日复盘",
    detail: "整理今天完成了什么、卡在哪里、明天先做什么。",
    icon: "🌿",
    order: 1
  }),
  createWorkflowItem({
    id: "habit-2",
    name: "清空收件箱",
    detail: "把零散想法归入事项、习惯或临时任务。",
    icon: "📥",
    order: 2
  })
];

const initialTempTasks: WorkflowItem[] = [
  createWorkflowItem({
    id: "temp-1",
    name: "临时记录",
    detail: "随手放一个还没想好日期和优先级的任务。",
    icon: "📝",
    order: 1
  })
];

function createTask(overrides: Partial<TaskEvent> = {}): TaskEvent {
  const timestamp = nowIso();
  return {
    id: createId("task"),
    date: "",
    timeKind: "range",
    startTime: "09:00",
    endTime: "10:00",
    title: "新事项",
    detail: "",
    icon: "📌",
    completed: false,
    completedAt: null,
    priority: "none",
    listId: "inbox",
    subtasks: [],
    reminderAt: "",
    recurrence: "none",
    createdAt: timestamp,
    updatedAt: timestamp,
    order: Date.now(),
    ...overrides
  };
}

const initialTasks: TaskEvent[] = [
  createTask({
    id: "event-1",
    date: formatDateKey(new Date()),
    title: "整理任务",
    detail: "梳理今天要完成的任务，确认优先级和预计完成时间。",
    icon: "✅",
    priority: "high",
    listId: "work",
    subtasks: [
      { id: "sub-1", title: "确认优先级", completed: true },
      { id: "sub-2", title: "估算完成时间", completed: false }
    ],
    order: 1
  }),
  createTask({
    id: "event-2",
    title: "项目复盘",
    detail: "回顾当前桌面应用的日历交互，记录需要继续优化的细节。",
    icon: "📌",
    date: formatDateKey(new Date()),
    startTime: "14:00",
    endTime: "15:00",
    priority: "medium",
    listId: "work",
    recurrence: "weekly",
    order: 2
  }),
  createTask({
    id: "event-3",
    title: "线上会议",
    detail: "讨论待办列表的数据结构、保存方式和后续提醒能力。",
    icon: "💻",
    date: formatDateKey(new Date()),
    startTime: "16:30",
    endTime: "17:00",
    listId: "inbox",
    order: 3
  })
];

function normalizeTask(task: Partial<TaskEvent>, index: number): TaskEvent {
  const timeKind = inferTimeKind(task);
  const timeFields = normalizeTimeFields({
    timeKind,
    startTime: task.startTime ?? "",
    endTime: task.endTime ?? ""
  });

  return createTask({
    ...task,
    timeKind,
    ...timeFields,
    id: task.id ?? createId("task"),
    title: task.title ?? "未命名事项",
    date: typeof task.date === "string" ? task.date : "",
    completed: Boolean(task.completed),
    completedAt: task.completedAt ?? null,
    priority: task.priority ?? "none",
    listId: task.listId ?? "inbox",
    subtasks: task.subtasks ?? [],
    reminderAt: task.reminderAt ?? "",
    recurrence: task.recurrence ?? "none",
    createdAt: task.createdAt ?? nowIso(),
    updatedAt: task.updatedAt ?? nowIso(),
    order: task.order ?? index
  });
}

function normalizeWorkflowItem(
  item: Partial<WorkflowItem>,
  index: number,
  defaultIcon = "📝"
): WorkflowItem {
  return createWorkflowItem({
    ...item,
    id: item.id ?? createId("workflow"),
    name: item.name ?? "未命名",
    detail: item.detail ?? "",
    icon: item.icon ?? defaultIcon,
    createdAt: item.createdAt ?? nowIso(),
    updatedAt: item.updatedAt ?? nowIso(),
    order: item.order ?? index
  });
}

function normalizeWorkflowCard(item: Partial<WorkflowCard>, index: number): WorkflowCard {
  return createWorkflowCard({
    ...item,
    id: item.id ?? createId("flow-card"),
    sourceKind: item.sourceKind ?? "task",
    sourceId: item.sourceId ?? "",
    title: item.title ?? "未命名卡片",
    detail: item.detail ?? "",
    icon: item.icon ?? "📌",
    timeLabel: item.timeLabel ?? "",
    priority: item.priority ?? "none",
    createdAt: item.createdAt ?? nowIso(),
    updatedAt: item.updatedAt ?? nowIso(),
    order: item.order ?? index
  });
}

function normalizeWaitingWorkflowCard(
  item: Partial<WaitingWorkflowCard>,
  index: number
): WaitingWorkflowCard {
  return createWaitingWorkflowCard({
    ...normalizeWorkflowCard(item, index),
    waitUntil: item.waitUntil ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    insertPosition: item.insertPosition === "head" ? "head" : "tail"
  });
}

function normalizeData(data: Partial<AppData> | null | undefined): AppData {
  if (!data || !Array.isArray(data.tasks)) {
    return {
      schemaVersion: 1,
      tasks: initialTasks,
      lists: initialLists,
      tags: initialTags,
      tagAssignments: {},
      habits: initialHabits,
      tempTasks: initialTempTasks,
      workflowCards: [],
      waitingWorkflowCards: [],
      notifiedReminderIds: []
    };
  }

  return {
    schemaVersion: 1,
    tasks: data.tasks.map(normalizeTask),
    lists: Array.isArray(data.lists) && data.lists.length > 0 ? data.lists : initialLists,
    tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags : initialTags,
    tagAssignments: data.tagAssignments ?? {},
    habits: Array.isArray(data.habits)
      ? data.habits.map((item, index) => normalizeWorkflowItem(item, index, "🌿"))
      : initialHabits,
    tempTasks: Array.isArray(data.tempTasks)
      ? data.tempTasks.map((item, index) => normalizeWorkflowItem(item, index, "📝"))
      : initialTempTasks,
    workflowCards: Array.isArray(data.workflowCards)
      ? data.workflowCards.map(normalizeWorkflowCard)
      : [],
    waitingWorkflowCards: Array.isArray(data.waitingWorkflowCards)
      ? data.waitingWorkflowCards.map(normalizeWaitingWorkflowCard)
      : [],
    notifiedReminderIds: data.notifiedReminderIds ?? []
  };
}

const codexStatusLabels: Record<CodexStatusValue, string> = {
  working: "工作中",
  pending_approval: "审批中",
  done: "空闲中",
  idle: "空闲中"
};

function normalizeCodexStatus(data: Partial<CodexStatusData> | null | undefined) {
  const status =
    data?.status === "working" ||
    data?.status === "pending_approval" ||
    data?.status === "done" ||
    data?.status === "idle"
      ? data.status
      : "idle";

  return {
    status,
    message: data?.message?.trim() || (status === "idle" ? "无请求" : codexStatusLabels[status]),
    updatedAt: data?.updatedAt ?? "",
    match: data?.match
  };
}

function normalizeWorkflowReturnAlert(
  data: Partial<WorkflowReturnAlert> | null | undefined
) {
  if (!data || data.acknowledged) {
    return null;
  }

  const title = data.title?.trim() || "工作流事项";
  const count = Math.max(1, Number(data.count) || 1);
  return {
    id: data.id || createId("workflow-alert"),
    title,
    count,
    message:
      data.message?.trim() ||
      (count > 1 ? `${title} 等 ${count} 项已回到工作流` : `${title} 已回到工作流`),
    createdAt: data.createdAt || nowIso(),
    acknowledged: false
  };
}

function normalizeCodexDetectorSettings(
  settings: Partial<CodexDetectorSettings> | null | undefined
): CodexDetectorSettings {
  return {
    ...defaultCodexDetectorSettings,
    ...settings,
    enabled: settings?.enabled ?? defaultCodexDetectorSettings.enabled,
    templateWidth: settings?.templateWidth || defaultCodexDetectorSettings.templateWidth,
    templateHeight: settings?.templateHeight || defaultCodexDetectorSettings.templateHeight,
    templateScalePercent:
      settings?.templateScalePercent || defaultCodexDetectorSettings.templateScalePercent,
    screenWidth: settings?.screenWidth || defaultCodexDetectorSettings.screenWidth,
    screenHeight: settings?.screenHeight || defaultCodexDetectorSettings.screenHeight,
    screenScalePercent: settings?.screenScalePercent || defaultCodexDetectorSettings.screenScalePercent
  };
}

function computeCodexDetectorScale(settings: CodexDetectorSettings) {
  const widthRatio = settings.screenWidth / Math.max(1, settings.templateWidth);
  const heightRatio = settings.screenHeight / Math.max(1, settings.templateHeight);
  const resolutionRatio = Math.sqrt(widthRatio * heightRatio);
  const dpiRatio =
    settings.screenScalePercent / Math.max(1, settings.templateScalePercent);
  return Math.min(2.5, Math.max(0.4, resolutionRatio * dpiRatio));
}

function resolveCodexStatusDisplay(data: CodexStatusData) {
  const normalized = normalizeCodexStatus(data);
  const updatedTime = normalized.updatedAt ? Date.parse(normalized.updatedAt) : NaN;
  const isStale =
    (normalized.status === "working" || normalized.status === "pending_approval") &&
    (!Number.isFinite(updatedTime) || Date.now() - updatedTime > 10 * 60 * 1000);

  if (isStale) {
    return {
      ...normalized,
      status: "pending_approval" as CodexStatusValue,
      label: "审批中",
      message: normalized.message || "状态可能过期"
    };
  }

  return {
    ...normalized,
    label: codexStatusLabels[normalized.status]
  };
}

function CodexStatusPanel() {
  const [workflowAlert, setWorkflowAlert] = useState<WorkflowReturnAlert | null>(null);
  const [statusData, setStatusData] = useState<CodexStatusData>({
    status: "idle",
    message: "无请求"
  });

  useEffect(() => {
    let cancelled = false;

    function loadStatus() {
      Promise.all([
        invoke<CodexStatusData | null>("load_codex_status"),
        invoke<WorkflowReturnAlert | null>("load_workflow_return_alert")
      ])
        .then(([data, alert]) => {
          if (!cancelled) {
            setStatusData(normalizeCodexStatus(data));
            setWorkflowAlert(normalizeWorkflowReturnAlert(alert));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatusData({ status: "idle", message: "无请求" });
          }
        });
    }

    loadStatus();
    const timer = window.setInterval(loadStatus, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const display = resolveCodexStatusDisplay(statusData);
  const title = workflowAlert
    ? `${display.label}：${workflowAlert.message || "等待事项已回到工作流，点击确认"}`
    : `${display.label}${display.message ? `：${display.message}` : ""}`;

  return (
    <main
      className={`codex-status-window ${display.status} ${
        workflowAlert ? "workflow-alert" : ""
      }`}
      title={title}
      onClick={() => {
        if (!workflowAlert) {
          return;
        }
        invoke("acknowledge_workflow_return_alert")
          .then(() => setWorkflowAlert(null))
          .catch(() => undefined);
      }}
      onMouseDown={() => {
        if (!workflowAlert) {
          getCurrentWindow().startDragging().catch(() => undefined);
        }
      }}
    >
      <div className="traffic-lights" aria-label={title}>
        <span className="traffic-light red" />
        <span className="traffic-light yellow" />
        <span className="traffic-light green" />
      </div>
      <span className="codex-status-text">{display.label}</span>
      {workflowAlert ? (
        <span className="workflow-alert-flag" aria-label="工作流回流待确认">
          <Flag size={28} />
        </span>
      ) : null}
    </main>
  );
}

function CodexNavIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="codex-nav-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g fill="currentColor" opacity="0.95" transform="rotate(-10 12 12)">
        <polygon points="8.2,7.3 14,6.4 18.3,10.5 16.1,16.3 10.1,17.2 5.8,13.1" />
        <circle cx="8.2" cy="7.3" r="4.25" />
        <circle cx="14" cy="6.4" r="4.25" />
        <circle cx="18.3" cy="10.5" r="4.25" />
        <circle cx="16.1" cy="16.3" r="4.25" />
        <circle cx="10.1" cy="17.2" r="4.25" />
        <circle cx="5.8" cy="13.1" r="4.25" />
      </g>
      <path
        d="m7.35 9.55 2.45 2.9-2.45 2.9"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.15"
      />
      <path
        d="M13.5 15.1h4.2"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeWidth="2.15"
      />
    </svg>
  );
}

function App() {
  const isCodexStatusPanel =
    new URLSearchParams(window.location.search).get("panel") === "codex-status";

  if (isCodexStatusPanel) {
    return <CodexStatusPanel />;
  }

  const [view, setView] = useState<View>("calendar");
  const [today, setToday] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [selectedDate, setSelectedDate] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
    day: today.getDate()
  });
  const [tasks, setTasks] = useState<TaskEvent[]>(initialTasks);
  const [lists, setLists] = useState<TaskList[]>(initialLists);
  const [tags, setTags] = useState<CalendarTag[]>(initialTags);
  const [tagAssignments, setTagAssignments] = useState<Record<string, string[]>>({});
  const [habits, setHabits] = useState<WorkflowItem[]>(initialHabits);
  const [tempTasks, setTempTasks] = useState<WorkflowItem[]>(initialTempTasks);
  const [workflowCards, setWorkflowCards] = useState<WorkflowCard[]>([]);
  const [waitingWorkflowCards, setWaitingWorkflowCards] = useState<WaitingWorkflowCard[]>([]);
  const [codexDetectorEnabled, setCodexDetectorEnabled] = useState(true);
  const [codexDetectorSettings, setCodexDetectorSettings] = useState<CodexDetectorSettings>(
    defaultCodexDetectorSettings
  );
  const [codexDetectorSaving, setCodexDetectorSaving] = useState(false);
  const [codexDetectorStatus, setCodexDetectorStatus] = useState<CodexStatusData>({
    status: "idle",
    message: "等待检测"
  });
  const [codexMatchImageUrl, setCodexMatchImageUrl] = useState("");
  const [notifiedReminderIds, setNotifiedReminderIds] = useState<string[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(initialTasks[0].id);
  const [selectedListId, setSelectedListId] = useState<SelectedListId>("today");
  const [taskSearch, setTaskSearch] = useState("");
  const [sortMode, setSortMode] = useState<"time" | "priority" | "manual">("time");
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState<EmojiTarget>({ type: "event" });
  const [tagDeleteMode, setTagDeleteMode] = useState(false);
  const [dayTagDeleteMode, setDayTagDeleteMode] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerTarget, setTagPickerTarget] = useState<TagPickerTarget>("day");
  const [animatedTagId, setAnimatedTagId] = useState("");
  const [tagDeleteAnimatingIds, setTagDeleteAnimatingIds] = useState<string[]>([]);
  const [animatedDateTagKey, setAnimatedDateTagKey] = useState("");
  const [animatedEventId, setAnimatedEventId] = useState("");
  const [eventDeleteAnimatingIds, setEventDeleteAnimatingIds] = useState<string[]>([]);
  const [completedPulseId, setCompletedPulseId] = useState("");
  const [dragHoverDateKey, setDragHoverDateKey] = useState("");
  const [draggingTagId, setDraggingTagId] = useState("");
  const [dragPointerPosition, setDragPointerPosition] = useState({ x: 0, y: 0 });
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [dragOverTaskId, setDragOverTaskId] = useState("");
  const [draggingWorkflowSource, setDraggingWorkflowSource] = useState<WorkflowCard | null>(null);
  const [draggingWorkflowCardId, setDraggingWorkflowCardId] = useState("");
  const [dragOverWorkflowCardId, setDragOverWorkflowCardId] = useState("");
  const [workflowInsertPosition, setWorkflowInsertPosition] =
    useState<WorkflowInsertPosition>("after");
  const [workflowDropTarget, setWorkflowDropTarget] = useState<WorkflowDropTarget>("");
  const [pendingWaitingCard, setPendingWaitingCard] = useState<PendingWaitingCard | null>(null);
  const [waitingMode, setWaitingMode] = useState<"duration" | "endTime">("duration");
  const [waitingMinutes, setWaitingMinutes] = useState(10);
  const [waitingEndTime, setWaitingEndTime] = useState(() =>
    toDateTimeInputValue(new Date(Date.now() + 10 * 60 * 1000).toISOString())
  );
  const [waitingInsertPosition, setWaitingInsertPosition] = useState<"head" | "tail">("tail");
  const [workflowEditorTarget, setWorkflowEditorTarget] =
    useState<WorkflowEditorTarget | null>(null);
  const [slideDirection, setSlideDirection] = useState<SlideDirection>("up");
  const [calendarKey, setCalendarKey] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("正在读取数据...");
  const [toast, setToast] = useState("");
  const monthTitleRef = useRef<HTMLDivElement>(null);
  const dayClickTimerRef = useRef<number | null>(null);
  const eventClickTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const draggingWorkflowSourceRef = useRef<WorkflowCard | null>(null);
  const draggingWorkflowCardIdRef = useRef("");
  const pendingTagDragRef = useRef<{
    tagId: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const pendingWorkflowDragRef = useRef<{
    sourceCard?: WorkflowCard;
    cardId?: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const suppressNextTagClickRef = useRef(false);
  const touchStartY = useRef<number | null>(null);
  const mouseStartY = useRef<number | null>(null);

  const selectedDateObject = dateFromParts(selectedDate);
  const selectedDateKey = formatDateKey(selectedDateObject);
  const selectedEvent =
    tasks.find((event) => event.id === selectedEventId) ?? null;
  const selectedList = lists.find((list) => list.id === selectedListId);
  const selectedDateTags = (tagAssignments[selectedDateKey] ?? [])
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is CalendarTag => Boolean(tag));
  const draggingTag = tags.find((tag) => tag.id === draggingTagId) ?? null;
  const draggingWorkflowPreview =
    draggingWorkflowSource ??
    workflowCards.find((card) => card.id === draggingWorkflowCardId) ??
    null;
  const todayKey = useMemo(() => formatDateKey(today), [today]);

  const dayEvents = useMemo(() => {
    return tasks
      .filter((event) => event.date === selectedDateKey)
      .sort((a, b) => compareTaskTime(a, b));
  }, [tasks, selectedDateKey]);

  const workflowCurrentTask = useMemo(() => {
    return (
      selectedEvent ??
      tasks
        .filter((task) => !task.completed)
        .sort((a, b) => compareTaskDate(a, b) || compareTaskTime(a, b))[0] ??
      null
    );
  }, [selectedEvent, tasks]);

  const workflowTaskPreview = useMemo(() => {
    return tasks
      .filter((task) => !task.completed)
      .sort((a, b) => compareTaskDate(a, b) || compareTaskTime(a, b))
      .slice(0, 8);
  }, [tasks]);

  const openTaskCountByDate = useMemo(() => {
    return tasks.reduce<Record<string, number>>((counts, task) => {
      if (!task.completed && task.date) {
        counts[task.date] = (counts[task.date] ?? 0) + 1;
      }
      return counts;
    }, {});
  }, [tasks]);

  const days = useMemo(() => {
    const start = new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1);
    const offset = start.getDay();
    const total = new Date(
      visibleDate.getFullYear(),
      visibleDate.getMonth() + 1,
      0
    ).getDate();
    const previousTotal = new Date(
      visibleDate.getFullYear(),
      visibleDate.getMonth(),
      0
    ).getDate();

    const previousDays = Array.from({ length: offset }, (_, index) => {
      const day = previousTotal - offset + index + 1;
      return {
        date: new Date(visibleDate.getFullYear(), visibleDate.getMonth() - 1, day),
        day,
        inCurrentMonth: false
      };
    });

    const currentDays = Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      return {
        date: new Date(visibleDate.getFullYear(), visibleDate.getMonth(), day),
        day,
        inCurrentMonth: true
      };
    });

    const nextDaysCount = 42 - previousDays.length - currentDays.length;
    const nextDays = Array.from({ length: nextDaysCount }, (_, index) => {
      const day = index + 1;
      return {
        date: new Date(visibleDate.getFullYear(), visibleDate.getMonth() + 1, day),
        day,
        inCurrentMonth: false
      };
    });

    return [...previousDays, ...currentDays, ...nextDays];
  }, [visibleDate]);

  const calendarRows = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) =>
      days.slice(index * 7, index * 7 + 7)
    );
  }, [days]);

  const selectedWeekIndex = useMemo(() => {
    const index = days.findIndex(
      (day) =>
        day.day === selectedDate.day &&
        day.date.getFullYear() === selectedDate.year &&
        day.date.getMonth() === selectedDate.month
    );

    return Math.max(0, Math.floor(index / 7));
  }, [days, selectedDate]);

  const filteredTasks = useMemo(() => {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekKey = formatDateKey(nextWeek);
    const search = taskSearch.trim().toLowerCase();

    return tasks
      .filter((task) => {
        if (selectedListId === "today") {
          return task.date === todayKey && !task.completed;
        }
        if (selectedListId === "upcoming") {
          return isTaskDateInRange(task, todayKey, nextWeekKey) && !task.completed;
        }
        if (selectedListId === "important") {
          return task.priority === "high" && !task.completed;
        }
        if (selectedListId === "completed") {
          return task.completed;
        }
        if (selectedListId === "all") {
          return true;
        }
        return task.listId === selectedListId && !task.completed;
      })
      .filter((task) => {
        if (!search) {
          return true;
        }
        return `${task.title} ${task.detail}`.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        if (sortMode === "priority") {
          const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };
          return rank[a.priority] - rank[b.priority] || compareTaskDate(a, b);
        }
        if (sortMode === "manual") {
          return a.order - b.order;
        }
        const dateCompare = compareTaskDate(a, b);
        return dateCompare === 0 ? compareTaskTime(a, b) : dateCompare;
      });
  }, [tasks, selectedListId, sortMode, taskSearch, today, todayKey]);

  const smartCounts = useMemo(() => {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekKey = formatDateKey(nextWeek);
    return {
      today: tasks.filter((task) => task.date === todayKey && !task.completed).length,
      upcoming: tasks.filter(
        (task) => isTaskDateInRange(task, todayKey, nextWeekKey) && !task.completed
      ).length,
      important: tasks.filter((task) => task.priority === "high" && !task.completed).length,
      completed: tasks.filter((task) => task.completed).length,
      all: tasks.length
    };
  }, [tasks, today, todayKey]);

  const title =
    view === "calendar"
      ? "日历"
      : view === "events"
        ? "事项列表"
        : view === "workflow"
          ? "工作流"
          : "状态检测";
  const subtitle =
    view === "calendar"
      ? "查看本月安排和日期状态"
      : view === "events"
        ? "按清单、时间和优先级管理全部事项"
        : view === "workflow"
          ? "聚焦当前任务，整理习惯和临时任务"
          : "控制 Codex 工作状态检测的启动与记忆";
  const isCurrentMonth =
    visibleDate.getFullYear() === today.getFullYear() &&
    visibleDate.getMonth() === today.getMonth();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday((currentToday) => {
        const nextToday = new Date();
        return formatDateKey(nextToday) === formatDateKey(currentToday)
          ? currentToday
          : nextToday;
      });
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AppData | null>("load_app_data")
      .then((storedData) => {
        if (cancelled) {
          return;
        }
        const nextData = normalizeData(storedData);
        setTasks(nextData.tasks);
        setLists(nextData.lists);
        setTags(nextData.tags);
        setTagAssignments(nextData.tagAssignments);
        setHabits(nextData.habits);
        setTempTasks(nextData.tempTasks);
        setWorkflowCards(nextData.workflowCards);
        setWaitingWorkflowCards(nextData.waitingWorkflowCards);
        setNotifiedReminderIds(nextData.notifiedReminderIds);
        setSelectedEventId(nextData.tasks[0]?.id ?? "");
        setSaveStatus("数据已载入");
      })
      .catch(() => {
        if (!cancelled) {
          setSaveStatus("读取失败，正在使用默认数据");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDataLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<CodexDetectorSettings>("load_codex_detector_settings")
      .then((settings) => {
        if (!cancelled) {
          const normalized = normalizeCodexDetectorSettings(settings);
          setCodexDetectorSettings(normalized);
          setCodexDetectorEnabled(normalized.enabled);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCodexDetectorSettings(defaultCodexDetectorSettings);
          setCodexDetectorEnabled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view !== "codex") {
      return;
    }

    let cancelled = false;
    let currentImageUrl = "";

    async function loadDetectorPreview() {
      try {
        const [statusData, imageBytes] = await Promise.all([
          invoke<CodexStatusData | null>("load_codex_status"),
          invoke<number[] | null>("load_codex_match_image")
        ]);
        if (cancelled) {
          return;
        }

        setCodexDetectorStatus(normalizeCodexStatus(statusData));
        const nextImageUrl = imageBytes?.length
          ? URL.createObjectURL(
              new Blob([new Uint8Array(imageBytes)], { type: "image/png" })
            )
          : "";
        if (currentImageUrl) {
          URL.revokeObjectURL(currentImageUrl);
        }
        currentImageUrl = nextImageUrl;
        setCodexMatchImageUrl(nextImageUrl);
      } catch {
        if (!cancelled) {
          setCodexDetectorStatus({ status: "pending_approval", message: "读取检测结果失败" });
        }
      }
    }

    void loadDetectorPreview();
    const timer = window.setInterval(loadDetectorPreview, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (currentImageUrl) {
        URL.revokeObjectURL(currentImageUrl);
      }
      setCodexMatchImageUrl("");
    };
  }, [view]);

  useEffect(() => {
    if (!dataLoaded) {
      return;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveStatus("正在保存...");
    saveTimerRef.current = window.setTimeout(() => {
      const payload: AppData = {
        schemaVersion: 1,
        tasks,
        lists,
        tags,
        tagAssignments,
        habits,
        tempTasks,
        workflowCards,
        waitingWorkflowCards,
        notifiedReminderIds
      };
      invoke("save_app_data", { data: payload })
        .then(() => setSaveStatus("已保存"))
        .catch(() => setSaveStatus("保存失败"));
    }, 500);
  }, [
    dataLoaded,
    habits,
    lists,
    notifiedReminderIds,
    tagAssignments,
    tags,
    tasks,
    tempTasks,
    waitingWorkflowCards,
    workflowCards
  ]);

  useEffect(() => {
    if (selectedDateTags.length === 0 && dayTagDeleteMode) {
      setDayTagDeleteMode(false);
    }
  }, [dayTagDeleteMode, selectedDateTags.length]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        monthPickerOpen &&
        monthTitleRef.current &&
        !monthTitleRef.current.contains(event.target as Node)
      ) {
        setMonthPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [monthPickerOpen]);

  useEffect(() => {
    if (view !== "calendar") {
      return;
    }

    if (dayEvents.length === 0) {
      setSelectedEventId("");
      return;
    }

    if (!dayEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(dayEvents[0].id);
    }
  }, [dayEvents, selectedEventId, view]);

  useEffect(() => {
    return () => {
      if (dayClickTimerRef.current !== null) {
        window.clearTimeout(dayClickTimerRef.current);
      }
      if (eventClickTimerRef.current !== null) {
        window.clearTimeout(eventClickTimerRef.current);
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function dateKeyFromPointer(event: PointerEvent) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      return target
        ?.closest<HTMLButtonElement>(".day-cell[data-date-key]")
        ?.dataset.dateKey;
    }

    function workflowTargetFromPointer(event: PointerEvent) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const card = target?.closest<HTMLElement>(".workflow-card[data-workflow-card-id]");
      const cardId = card?.dataset.workflowCardId ?? "";
      const insertPosition: WorkflowInsertPosition =
        card && event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2
          ? "before"
          : "after";
      const dropPanel = target?.closest<HTMLElement>(".workflow-drop-panel");
      const dropTarget: WorkflowDropTarget = dropPanel?.classList.contains("waiting")
        ? "waiting"
        : dropPanel?.classList.contains("queue")
          ? "queue"
          : "";
      return { cardId, dropTarget, insertPosition };
    }

    function handlePointerMove(event: PointerEvent) {
      const pendingDrag = pendingTagDragRef.current;
      if (pendingDrag && !tagDeleteMode && calendarMode === "month") {
        const moveX = event.clientX - pendingDrag.x;
        const moveY = event.clientY - pendingDrag.y;
        const isPastDragThreshold = Math.hypot(moveX, moveY) > 6;

        if (!pendingDrag.active && isPastDragThreshold) {
          pendingDrag.active = true;
          setDraggingTagId(pendingDrag.tagId);
        }

        if (pendingDrag.active) {
          event.preventDefault();
          setDragPointerPosition({ x: event.clientX, y: event.clientY });
          setDragHoverDateKey(dateKeyFromPointer(event) ?? "");
        }
      }

      const pendingWorkflowDrag = pendingWorkflowDragRef.current;
      if (!pendingWorkflowDrag) {
        return;
      }

      const workflowMoveX = event.clientX - pendingWorkflowDrag.x;
      const workflowMoveY = event.clientY - pendingWorkflowDrag.y;
      const isWorkflowPastDragThreshold =
        Math.hypot(workflowMoveX, workflowMoveY) > 6;

      if (!pendingWorkflowDrag.active && isWorkflowPastDragThreshold) {
        pendingWorkflowDrag.active = true;
        if (pendingWorkflowDrag.sourceCard) {
          draggingWorkflowSourceRef.current = pendingWorkflowDrag.sourceCard;
          setDraggingWorkflowSource(pendingWorkflowDrag.sourceCard);
        }
        if (pendingWorkflowDrag.cardId) {
          draggingWorkflowCardIdRef.current = pendingWorkflowDrag.cardId;
          setDraggingWorkflowCardId(pendingWorkflowDrag.cardId);
        }
      }

      if (pendingWorkflowDrag.active) {
        event.preventDefault();
        setDragPointerPosition({ x: event.clientX, y: event.clientY });
        const workflowTarget = workflowTargetFromPointer(event);
        setWorkflowDropTarget(workflowTarget.dropTarget);
        setDragOverWorkflowCardId(workflowTarget.cardId);
        setWorkflowInsertPosition(workflowTarget.insertPosition);
      }
    }

    function handlePointerUp(event: PointerEvent) {
      const pendingDrag = pendingTagDragRef.current;
      if (pendingDrag?.active && calendarMode === "month") {
        const dateKey = dateKeyFromPointer(event);
        if (dateKey) {
          assignTagToDate(pendingDrag.tagId, dateKey);
        }
        suppressNextTagClickRef.current = true;
        window.setTimeout(() => {
          suppressNextTagClickRef.current = false;
        }, 120);
      }

      pendingTagDragRef.current = null;
      setDraggingTagId("");
      setDragPointerPosition({ x: 0, y: 0 });
      setDragHoverDateKey("");

      const pendingWorkflowDrag = pendingWorkflowDragRef.current;
      if (pendingWorkflowDrag?.active) {
        const workflowTarget = workflowTargetFromPointer(event);
        if (
          pendingWorkflowDrag.cardId &&
          workflowTarget.cardId &&
          workflowTarget.cardId !== pendingWorkflowDrag.cardId
        ) {
          reorderWorkflowCard(
            pendingWorkflowDrag.cardId,
            workflowTarget.cardId,
            workflowTarget.insertPosition
          );
        } else if (workflowTarget.dropTarget === "waiting") {
          if (pendingWorkflowDrag.sourceCard) {
            openWaitingSettings(pendingWorkflowDrag.sourceCard);
          } else if (pendingWorkflowDrag.cardId) {
            const card = workflowCards.find(
              (item) => item.id === pendingWorkflowDrag.cardId
            );
            if (card) {
              openWaitingSettings(card, card.id);
            }
          }
        } else if (workflowTarget.dropTarget === "queue") {
          if (pendingWorkflowDrag.sourceCard) {
            addWorkflowCard(
              pendingWorkflowDrag.sourceCard,
              workflowTarget.cardId
                ? { targetId: workflowTarget.cardId, position: workflowTarget.insertPosition }
                : { position: "tail" }
            );
          } else if (pendingWorkflowDrag.cardId && !workflowTarget.cardId) {
            moveWorkflowCardToTail(pendingWorkflowDrag.cardId);
          }
        }
      }

      pendingWorkflowDragRef.current = null;
      resetWorkflowDragState();
      setDragPointerPosition({ x: 0, y: 0 });
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [calendarMode, tagDeleteMode, tagAssignments, tags, workflowCards]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const dueTasks = tasks.filter((task) => {
        if (!task.reminderAt || task.completed || notifiedReminderIds.includes(task.id)) {
          return false;
        }
        return new Date(task.reminderAt).getTime() <= now;
      });

      if (dueTasks.length === 0) {
        return;
      }

      setNotifiedReminderIds((ids) => [...ids, ...dueTasks.map((task) => task.id)]);
      const message = `${dueTasks[0].icon} ${dueTasks[0].title}`;
      setToast(`提醒：${message}`);
      window.setTimeout(() => setToast(""), 4200);
      dueTasks.forEach((task) => {
        void notifyTask(task);
      });
    }, 30000);

    return () => window.clearInterval(timer);
  }, [notifiedReminderIds, tasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const dueCards = waitingWorkflowCards.filter((card) => {
        const waitUntil = new Date(card.waitUntil).getTime();
        return Number.isFinite(waitUntil) && waitUntil <= now;
      });

      if (dueCards.length === 0) {
        return;
      }

      setWaitingWorkflowCards((cards) =>
        cards.filter((card) => !dueCards.some((dueCard) => dueCard.id === card.id))
      );
      setWorkflowCards((cards) => {
        const headCards = dueCards
          .filter((card) => card.insertPosition === "head")
          .map((card) => createWorkflowCard({ ...card, id: card.id }));
        const tailCards = dueCards
          .filter((card) => card.insertPosition === "tail")
          .map((card) => createWorkflowCard({ ...card, id: card.id }));
        return [...headCards, ...cards, ...tailCards].map((card, index) => ({
          ...card,
          order: index,
          updatedAt: nowIso()
        }));
      });
      setToast(`${dueCards[0].title} 已加入工作流`);
      void invoke("save_workflow_return_alert", {
        data: {
          id: createId("workflow-return"),
          title: dueCards[0].title,
          count: dueCards.length,
          message:
            dueCards.length > 1
              ? `${dueCards[0].title} 等 ${dueCards.length} 项已回到工作流`
              : `${dueCards[0].title} 已回到工作流`,
          createdAt: nowIso(),
          acknowledged: false
        }
      });
      window.setTimeout(() => setToast(""), 2800);
    }, 10000);

    return () => window.clearInterval(timer);
  }, [waitingWorkflowCards]);

  function moveToMonth(nextDate: Date, direction: SlideDirection) {
    setSlideDirection(direction);
    setVisibleDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setCalendarKey((key) => key + 1);
  }

  function changeMonth(offset: number) {
    const nextDate = new Date(
      visibleDate.getFullYear(),
      visibleDate.getMonth() + offset,
      1
    );
    moveToMonth(nextDate, offset > 0 ? "up" : "down");
  }

  function selectToday() {
    const nextDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const currentIndex = visibleDate.getFullYear() * 12 + visibleDate.getMonth();
    const todayIndex = today.getFullYear() * 12 + today.getMonth();
    moveToMonth(nextDate, todayIndex >= currentIndex ? "up" : "down");
    setSelectedDate({
      year: today.getFullYear(),
      month: today.getMonth(),
      day: today.getDate()
    });
  }

  function selectMonth(month: number) {
    const direction = month >= visibleDate.getMonth() ? "up" : "down";
    moveToMonth(new Date(visibleDate.getFullYear(), month, 1), direction);
    setMonthPickerOpen(false);
  }

  function applyDaySelection(day: CalendarDay) {
    if (!day.inCurrentMonth) {
      const currentIndex = visibleDate.getFullYear() * 12 + visibleDate.getMonth();
      const nextIndex = day.date.getFullYear() * 12 + day.date.getMonth();
      moveToMonth(day.date, nextIndex >= currentIndex ? "up" : "down");
    }

    setSelectedDate({
      year: day.date.getFullYear(),
      month: day.date.getMonth(),
      day: day.day
    });
  }

  function selectDay(day: CalendarDay) {
    if (dayClickTimerRef.current !== null) {
      window.clearTimeout(dayClickTimerRef.current);
    }

    dayClickTimerRef.current = window.setTimeout(() => {
      applyDaySelection(day);
      dayClickTimerRef.current = null;
    }, 300);
  }

  function handleDayDoubleClick(day: CalendarDay) {
    if (dayClickTimerRef.current !== null) {
      window.clearTimeout(dayClickTimerRef.current);
      dayClickTimerRef.current = null;
    }

    applyDaySelection(day);
    if (calendarMode === "month") {
      setCalendarMode("detail");
    }
  }

  function addEvent(overrides: Partial<TaskEvent> = {}) {
    const defaultDate =
      view === "calendar"
        ? selectedDateKey
        : selectedListId === "today" || selectedListId === "upcoming"
          ? todayKey
          : "";
    const newEvent = createTask({
      date: defaultDate,
      listId: selectedList && !smartLists.some((list) => list.id === selectedList.id)
        ? selectedList.id
        : "inbox",
      order: tasks.length + 1,
      ...overrides
    });

    setTasks((currentEvents) => [...currentEvents, newEvent]);
    setSelectedEventId(newEvent.id);
    setAnimatedEventId(newEvent.id);
    window.setTimeout(() => setAnimatedEventId(""), 700);
  }

  function updateTask(taskId: string, changes: Partial<TaskEvent>) {
    setTasks((currentEvents) =>
      currentEvents.map((event) =>
        event.id === taskId
          ? {
              ...event,
              ...changes,
              ...(changes.timeKind
                ? normalizeTimeFields({
                    timeKind: changes.timeKind,
                    startTime: changes.startTime ?? event.startTime,
                    endTime: changes.endTime ?? event.endTime
                  })
                : {}),
              updatedAt: nowIso()
            }
          : event
      )
    );
  }

  function updateSelectedEvent(changes: Partial<TaskEvent>) {
    if (!selectedEvent) {
      return;
    }
    updateTask(selectedEvent.id, changes);
  }

  function toggleTaskCompleted(task: TaskEvent) {
    const completed = !task.completed;
    setCompletedPulseId(task.id);
    window.setTimeout(() => setCompletedPulseId(""), 700);

    updateTask(task.id, {
      completed,
      completedAt: completed ? nowIso() : null
    });

    if (completed && task.recurrence !== "none" && task.date) {
      const nextDate = nextDateForRecurrence(task.date, task.recurrence);
      const nextTask = createTask({
        ...task,
        id: createId("task"),
        date: nextDate,
        completed: false,
        completedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        order: Date.now(),
        subtasks: task.subtasks.map((subtask) => ({
          ...subtask,
          id: createId("subtask"),
          completed: false
        })),
        reminderAt: task.reminderAt
          ? `${nextDate}T${task.reminderAt.slice(11, 16)}`
          : ""
      });
      setTasks((currentEvents) => [...currentEvents, nextTask]);
      setAnimatedEventId(nextTask.id);
      setToast(`已生成下一次：${nextTask.title}`);
      window.setTimeout(() => {
        setAnimatedEventId("");
        setToast("");
      }, 2800);
    }
  }

  function deleteSelectedEvent() {
    if (!selectedEvent) {
      return;
    }
    deleteTask(selectedEvent.id);
  }

  function deleteTask(taskId: string) {
    setEventDeleteAnimatingIds((ids) => [...ids, taskId]);
    window.setTimeout(() => {
      setTasks((currentEvents) => currentEvents.filter((event) => event.id !== taskId));
      setEventDeleteAnimatingIds((ids) => ids.filter((id) => id !== taskId));
      if (selectedEventId === taskId) {
        setSelectedEventId("");
      }
    }, 260);
  }

  function addWorkflowItem(kind: "habit" | "temp") {
    const item = createWorkflowItem({
      id: createId(kind),
      name: kind === "habit" ? "新习惯" : "临时任务",
      detail: kind === "habit" ? "写下这个习惯的触发场景和目标。" : "记录一个暂时不需要排期的任务。",
      icon: kind === "habit" ? "🌿" : "📝",
      order: Date.now()
    });

    if (kind === "habit") {
      setHabits((items) => [...items, item]);
    } else {
      setTempTasks((items) => [...items, item]);
    }
  }

  function updateWorkflowItem(
    kind: "habit" | "temp",
    itemId: string,
    changes: Partial<Pick<WorkflowItem, "name" | "detail" | "icon">>
  ) {
    const update = (items: WorkflowItem[]) =>
      items.map((item) =>
        item.id === itemId ? { ...item, ...changes, updatedAt: nowIso() } : item
      );

    if (kind === "habit") {
      setHabits(update);
    } else {
      setTempTasks(update);
    }
  }

  function deleteWorkflowItem(kind: "habit" | "temp", itemId: string) {
    if (kind === "habit") {
      setHabits((items) => items.filter((item) => item.id !== itemId));
    } else {
      setTempTasks((items) => items.filter((item) => item.id !== itemId));
    }
  }

  function openWorkflowSourceEditor(
    sourceKind: WorkflowSourceKind,
    sourceId: string
  ) {
    if (sourceKind === "task") {
      setSelectedEventId(sourceId);
    }
    setWorkflowEditorTarget({ sourceKind, sourceId });
  }

  function createWorkflowCardFromSource(
    sourceKind: WorkflowSourceKind,
    source: TaskEvent | WorkflowItem
  ) {
    if (sourceKind === "task") {
      const task = source as TaskEvent;
      return createWorkflowCard({
        sourceKind,
        sourceId: task.id,
        title: task.title || "未命名事项",
        detail: task.detail,
        icon: task.icon,
        timeLabel: task.timeKind === "none" ? "" : formatTaskTime(task),
        priority: task.priority,
        order: Date.now()
      });
    }

    const item = source as WorkflowItem;
    return createWorkflowCard({
      sourceKind,
      sourceId: item.id,
      title: item.name || "未命名卡片",
      detail: item.detail,
      icon: item.icon,
      timeLabel: "",
      priority: "none",
      order: Date.now()
    });
  }

  function resetWorkflowDragState() {
    draggingWorkflowSourceRef.current = null;
    draggingWorkflowCardIdRef.current = "";
    setDraggingWorkflowSource(null);
    setDraggingWorkflowCardId("");
    setDragOverWorkflowCardId("");
    setWorkflowInsertPosition("after");
    setWorkflowDropTarget("");
  }

  function writeWorkflowSourceDragData(event: DragEvent<HTMLElement>, card: WorkflowCard) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(workflowSourceDragMime, JSON.stringify(card));
    event.dataTransfer.setData("text/plain", card.title);
    event.dataTransfer.setData("Text", card.title);
    draggingWorkflowSourceRef.current = card;
    draggingWorkflowCardIdRef.current = "";
    setDraggingWorkflowSource(card);
  }

  function writeWorkflowCardDragData(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(workflowCardDragMime, cardId);
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.setData("Text", cardId);
    draggingWorkflowCardIdRef.current = cardId;
    draggingWorkflowSourceRef.current = null;
    setDraggingWorkflowCardId(cardId);
  }

  function readWorkflowSourceDragData(event: DragEvent<HTMLElement>) {
    const text = event.dataTransfer.getData(workflowSourceDragMime);
    if (!text) {
      return draggingWorkflowSourceRef.current ?? draggingWorkflowSource;
    }
    try {
      return normalizeWorkflowCard(JSON.parse(text), Date.now());
    } catch {
      return draggingWorkflowSourceRef.current ?? draggingWorkflowSource;
    }
  }

  function readWorkflowCardDragId(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.getData(workflowCardDragMime) ||
      draggingWorkflowCardIdRef.current ||
      draggingWorkflowCardId
    );
  }

  function addWorkflowCard(
    card: WorkflowCard,
    insertTarget: WorkflowInsertTarget = { position: "tail" }
  ) {
    setWorkflowCards((cards) => {
      const nextCard = createWorkflowCard({
        ...card,
        id: createId("flow-card"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        order: Date.now()
      });
      let nextCards = [...cards];
      if ("targetId" in insertTarget) {
        const targetIndex = nextCards.findIndex((item) => item.id === insertTarget.targetId);
        if (targetIndex >= 0) {
          nextCards.splice(
            insertTarget.position === "before" ? targetIndex : targetIndex + 1,
            0,
            nextCard
          );
        } else {
          nextCards.push(nextCard);
        }
      } else if (insertTarget.position === "head") {
        nextCards = [nextCard, ...nextCards];
      } else {
        nextCards.push(nextCard);
      }
      return nextCards.map((item, index) => ({ ...item, order: index }));
    });
  }

  function addWaitingWorkflowCard(
    card: WorkflowCard,
    waitUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    insertPosition: "head" | "tail" = "tail"
  ) {
    setWaitingWorkflowCards((cards) => [
      ...cards,
      createWaitingWorkflowCard({
        ...card,
        id: createId("waiting-flow-card"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        waitUntil,
        insertPosition,
        order: Date.now()
      })
    ]);
  }

  function openWaitingSettings(card: WorkflowCard, sourceWorkflowCardId?: string) {
    setPendingWaitingCard({ card, sourceWorkflowCardId });
    setWaitingMode("duration");
    setWaitingMinutes(10);
    setWaitingEndTime(
      toDateTimeInputValue(new Date(Date.now() + 10 * 60 * 1000).toISOString())
    );
    setWaitingInsertPosition("tail");
  }

  function confirmWaitingSettings() {
    if (!pendingWaitingCard) {
      return;
    }

    const waitUntil =
      waitingMode === "duration"
        ? new Date(Date.now() + Math.max(1, waitingMinutes) * 60 * 1000).toISOString()
        : fromDateTimeInputValue(waitingEndTime);

    if (!waitUntil || new Date(waitUntil).getTime() <= Date.now()) {
      setToast("等待结束时间必须晚于现在");
      window.setTimeout(() => setToast(""), 2400);
      return;
    }

    if (pendingWaitingCard.sourceWorkflowCardId) {
      setWorkflowCards((cards) =>
        cards.filter((card) => card.id !== pendingWaitingCard.sourceWorkflowCardId)
      );
    }
    addWaitingWorkflowCard(
      pendingWaitingCard.card,
      waitUntil,
      waitingInsertPosition
    );
    setPendingWaitingCard(null);
  }

  function reorderWorkflowCard(
    activeId: string,
    targetId: string,
    position: WorkflowInsertPosition = "before"
  ) {
    if (activeId === targetId) {
      return;
    }
    setWorkflowCards((cards) => {
      const activeIndex = cards.findIndex((item) => item.id === activeId);
      const targetIndex = cards.findIndex((item) => item.id === targetId);
      if (activeIndex < 0 || targetIndex < 0) {
        return cards;
      }
      const nextCards = [...cards];
      const [moving] = nextCards.splice(activeIndex, 1);
      const nextTargetIndex = nextCards.findIndex((item) => item.id === targetId);
      if (nextTargetIndex < 0) {
        return cards;
      }
      nextCards.splice(position === "before" ? nextTargetIndex : nextTargetIndex + 1, 0, moving);
      return nextCards.map((item, index) => ({ ...item, order: index }));
    });
  }

  function moveWorkflowCardToTail(cardId: string) {
    setWorkflowCards((cards) => {
      const activeIndex = cards.findIndex((item) => item.id === cardId);
      if (activeIndex < 0 || activeIndex === cards.length - 1) {
        return cards;
      }

      const nextCards = [...cards];
      const [moving] = nextCards.splice(activeIndex, 1);
      nextCards.push(moving);
      return nextCards.map((item, index) => ({ ...item, order: index }));
    });
  }

  function deleteWorkflowCard(cardId: string) {
    setWorkflowCards((cards) => cards.filter((card) => card.id !== cardId));
  }

  function updateWorkflowCard(
    cardId: string,
    changes: Partial<Pick<WorkflowCard, "priority">>
  ) {
    setWorkflowCards((cards) =>
      cards.map((card) =>
        card.id === cardId ? { ...card, ...changes, updatedAt: nowIso() } : card
      )
    );
  }

  function completeWorkflowCard(card: WorkflowCard) {
    if (card.sourceKind === "task") {
      const sourceTask = tasks.find((task) => task.id === card.sourceId);
      if (sourceTask && !sourceTask.completed) {
        toggleTaskCompleted(sourceTask);
      }
    } else if (card.sourceKind === "temp") {
      setTempTasks((items) => items.filter((item) => item.id !== card.sourceId));
    }

    deleteWorkflowCard(card.id);
  }

  function deleteWaitingWorkflowCard(cardId: string) {
    setWaitingWorkflowCards((cards) => cards.filter((card) => card.id !== cardId));
  }

  function updateWaitingWorkflowCard(
    cardId: string,
    changes: Partial<
      Pick<WaitingWorkflowCard, "waitUntil" | "insertPosition" | "priority">
    >
  ) {
    setWaitingWorkflowCards((cards) =>
      cards.map((card) =>
        card.id === cardId ? { ...card, ...changes, updatedAt: nowIso() } : card
      )
    );
  }

  function handleWorkflowQueueDrop(event: DragEvent<HTMLElement>) {
    const sourceCard = readWorkflowSourceDragData(event);
    const cardId = readWorkflowCardDragId(event);
    if (sourceCard) {
      addWorkflowCard(sourceCard, { position: "tail" });
    } else if (cardId) {
      moveWorkflowCardToTail(cardId);
    }
    resetWorkflowDragState();
  }

  function handleWorkflowWaitingDrop(event: DragEvent<HTMLElement>) {
    const sourceCard = readWorkflowSourceDragData(event);
    const cardId = readWorkflowCardDragId(event);
    if (sourceCard) {
      openWaitingSettings(sourceCard);
    } else if (cardId) {
      const card = workflowCards.find((item) => item.id === cardId);
      if (card) {
        openWaitingSettings(card, card.id);
      }
    }
    resetWorkflowDragState();
  }

  function toggleCodexDetector() {
    const nextEnabled = !codexDetectorEnabled;
    setCodexDetectorEnabled(nextEnabled);
    setCodexDetectorSettings((settings) => ({ ...settings, enabled: nextEnabled }));
    setCodexDetectorSaving(true);
    invoke<boolean>("set_codex_detector_enabled", { enabled: nextEnabled })
      .then((enabled) => {
        setCodexDetectorEnabled(enabled);
        setCodexDetectorSettings((settings) => ({ ...settings, enabled }));
        setToast(enabled ? "Codex 状态检测已开启" : "Codex 状态检测已关闭");
      })
      .catch(() => {
        setCodexDetectorEnabled(!nextEnabled);
        setCodexDetectorSettings((settings) => ({ ...settings, enabled: !nextEnabled }));
        setToast("状态检测设置保存失败");
      })
      .finally(() => {
        setCodexDetectorSaving(false);
        window.setTimeout(() => setToast(""), 2200);
      });
  }

  function saveCodexDetectorSettings(changes: Partial<CodexDetectorSettings>) {
    const previousSettings = codexDetectorSettings;
    const nextSettings = normalizeCodexDetectorSettings({
      ...codexDetectorSettings,
      ...changes
    });
    setCodexDetectorSettings(nextSettings);
    setCodexDetectorEnabled(nextSettings.enabled);
    setCodexDetectorSaving(true);
    invoke<CodexDetectorSettings>("set_codex_detector_settings", { settings: nextSettings })
      .then((settings) => {
        const normalized = normalizeCodexDetectorSettings(settings);
        setCodexDetectorSettings(normalized);
        setCodexDetectorEnabled(normalized.enabled);
        setToast("匹配设置已保存");
      })
      .catch(() => {
        setCodexDetectorSettings(previousSettings);
        setCodexDetectorEnabled(previousSettings.enabled);
        setToast("匹配设置保存失败");
      })
      .finally(() => {
        setCodexDetectorSaving(false);
        window.setTimeout(() => setToast(""), 2200);
      });
  }

  function openEventInCalendar(event: TaskEvent) {
    if (!event.date) {
      setSelectedEventId(event.id);
      setView("events");
      setToast("无日期事项不能跳转到日历");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }

    const date = new Date(`${event.date}T00:00:00`);
    setSelectedDate({
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate()
    });
    setVisibleDate(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelectedEventId(event.id);
    setView("calendar");
  }

  function openEventInTaskList(event: TaskEvent) {
    setSelectedEventId(event.id);
    setSelectedListId("all");
    setView("events");
  }

  function handleEventListClick(event: TaskEvent) {
    if (eventClickTimerRef.current !== null) {
      window.clearTimeout(eventClickTimerRef.current);
    }

    eventClickTimerRef.current = window.setTimeout(() => {
      setSelectedEventId(event.id);
      eventClickTimerRef.current = null;
    }, 300);
  }

  function handleEventListDoubleClick(event: TaskEvent) {
    if (eventClickTimerRef.current !== null) {
      window.clearTimeout(eventClickTimerRef.current);
      eventClickTimerRef.current = null;
    }
    if (event.date) {
      openEventInCalendar(event);
    }
  }

  function addList() {
    const newList: TaskList = {
      id: createId("list"),
      name: "新清单",
      icon: "🗂️",
      color: "#6366f1",
      order: lists.length + 1
    };
    setLists((currentLists) => [...currentLists, newList]);
    setSelectedListId(newList.id);
  }

  function updateList(listId: string, changes: Partial<TaskList>) {
    setLists((currentLists) =>
      currentLists.map((list) => (list.id === listId ? { ...list, ...changes } : list))
    );
  }

  function deleteList(listId: string) {
    if (listId === "inbox") {
      return;
    }
    setLists((currentLists) => currentLists.filter((list) => list.id !== listId));
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.listId === listId ? { ...task, listId: "inbox" } : task
      )
    );
    setSelectedListId("all");
  }

  function addSubtask() {
    if (!selectedEvent) {
      return;
    }
    updateSelectedEvent({
      subtasks: [
        ...selectedEvent.subtasks,
        { id: createId("subtask"), title: "新子任务", completed: false }
      ]
    });
  }

  function updateSubtask(subtaskId: string, changes: Partial<Subtask>) {
    if (!selectedEvent) {
      return;
    }
    updateSelectedEvent({
      subtasks: selectedEvent.subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, ...changes } : subtask
      )
    });
  }

  function deleteSubtask(subtaskId: string) {
    if (!selectedEvent) {
      return;
    }
    updateSelectedEvent({
      subtasks: selectedEvent.subtasks.filter((subtask) => subtask.id !== subtaskId)
    });
  }

  function reorderTask(fromId: string, toId: string) {
    const visibleIds = filteredTasks.map((task) => task.id);
    const fromIndex = visibleIds.indexOf(fromId);
    const toIndex = visibleIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const reorderedIds = [...visibleIds];
    const [moved] = reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, moved);
    const orderMap = new Map(reorderedIds.map((id, index) => [id, index + 1]));

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        orderMap.has(task.id) ? { ...task, order: orderMap.get(task.id)! } : task
      )
    );
    setSortMode("manual");
  }

  function addTag(icon = "🏷️") {
    const tagId = createId("tag");
    const newTag: CalendarTag = {
      id: tagId,
      name: "新标签",
      icon
    };

    setTags((currentTags) => [...currentTags, newTag]);
    setAnimatedTagId(tagId);
    window.setTimeout(() => setAnimatedTagId(""), 700);
  }

  function updateTag(tagId: string, changes: Partial<CalendarTag>) {
    setTags((currentTags) =>
      currentTags.map((tag) => (tag.id === tagId ? { ...tag, ...changes } : tag))
    );
  }

  function deleteTag(tagId: string) {
    setTagDeleteAnimatingIds((ids) => [...ids, tagId]);
    window.setTimeout(() => {
      setTags((currentTags) => currentTags.filter((tag) => tag.id !== tagId));
      setTagAssignments((currentAssignments) => {
        const nextAssignments: Record<string, string[]> = {};
        Object.entries(currentAssignments).forEach(([dateKey, assignedTags]) => {
          const filteredTags = assignedTags.filter((id) => id !== tagId);
          if (filteredTags.length > 0) {
            nextAssignments[dateKey] = filteredTags;
          }
        });
        return nextAssignments;
      });
      setTagDeleteAnimatingIds((ids) => ids.filter((id) => id !== tagId));
    }, 260);
  }

  function assignTagToDate(tagId: string, dateKey: string) {
    setTagAssignments((currentAssignments) => {
      const currentTags = currentAssignments[dateKey] ?? [];
      if (currentTags.includes(tagId)) {
        return currentAssignments;
      }

      return {
        ...currentAssignments,
        [dateKey]: [...currentTags, tagId]
      };
    });
    setAnimatedDateTagKey(`${dateKey}-${tagId}`);
    window.setTimeout(() => setAnimatedDateTagKey(""), 700);
  }

  function removeTagFromDate(tagId: string, dateKey: string) {
    setTagAssignments((currentAssignments) => {
      const nextTags = (currentAssignments[dateKey] ?? []).filter(
        (id) => id !== tagId
      );
      const nextAssignments = { ...currentAssignments };

      if (nextTags.length === 0) {
        delete nextAssignments[dateKey];
        if (dateKey === selectedDateKey) {
          setDayTagDeleteMode(false);
        }
      } else {
        nextAssignments[dateKey] = nextTags;
      }

      return nextAssignments;
    });
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null || calendarMode === "detail") {
      return;
    }

    const deltaY = touchStartY.current - event.changedTouches[0].clientY;
    touchStartY.current = null;

    if (Math.abs(deltaY) > 45) {
      changeMonth(deltaY > 0 ? 1 : -1);
    }
  }

  function handleMouseUp(event: React.MouseEvent<HTMLDivElement>) {
    if (mouseStartY.current === null || calendarMode === "detail") {
      return;
    }

    const deltaY = mouseStartY.current - event.clientY;
    mouseStartY.current = null;

    if (Math.abs(deltaY) > 45) {
      changeMonth(deltaY > 0 ? 1 : -1);
    }
  }

  function renderDayButton(day: CalendarDay, isSelectedWeek: boolean) {
    const isToday =
      day.date.getFullYear() === today.getFullYear() &&
      day.date.getMonth() === today.getMonth() &&
      day.day === today.getDate();
    const isSelected =
      day.day === selectedDate.day &&
      day.date.getFullYear() === selectedDate.year &&
      day.date.getMonth() === selectedDate.month;
    const dateKey = formatDateKey(day.date);
    const eventCount = openTaskCountByDate[dateKey] ?? 0;
    const assignedTags = (tagAssignments[dateKey] ?? [])
      .map((tagId) => tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is CalendarTag => Boolean(tag));

    return (
      <button
        className={`day-cell ${isToday ? "today" : ""} ${
          isSelected ? "selected" : ""
        } ${day.inCurrentMonth ? "" : "muted"} ${
          dragHoverDateKey === dateKey ? "drag-hover" : ""
        }`}
        data-date-key={dateKey}
        key={day.date.toISOString()}
        type="button"
        onClick={() => selectDay(day)}
        onDoubleClick={() => handleDayDoubleClick(day)}
      >
        <span className="day-week-label">{weekLabels[day.date.getDay()]}</span>
        {calendarMode === "month" && assignedTags.length > 0 ? (
          <span className="day-tags">
            {assignedTags.slice(0, 3).map((tag) => (
              <span
                className={
                  animatedDateTagKey === `${dateKey}-${tag.id}`
                    ? "tag-pop-in"
                    : ""
                }
                key={tag.id}
                title={tag.name}
              >
                {tag.icon}
              </span>
            ))}
          </span>
        ) : null}
        <span className="day-number">{day.day}</span>
        {calendarMode === "month" && eventCount > 0 ? (
          <span className="day-event-dots" aria-label={`${eventCount} 个事项`}>
            {Array.from({ length: Math.min(eventCount, 5) }, (_, index) => (
              <span key={index} />
            ))}
          </span>
        ) : null}
        {calendarMode === "detail" && isSelectedWeek ? (
          <span className="day-month-label">{day.date.getMonth() + 1}月</span>
        ) : null}
      </button>
    );
  }

  function renderTimelineAgenda(row: CalendarDay[]) {
    const hours = Array.from({ length: 25 }, (_, index) => index);

    return (
      <div className="week-timeline" aria-label="本周时间轴">
        <div className="timeline-time-scale" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
        <div className="timeline-day-grid">
          {row.map((day) => {
            const dateKey = formatDateKey(day.date);
            const dayTasks = tasks
              .filter((task) => task.date === dateKey)
              .sort((a, b) => compareTaskTime(a, b));
            const taskLayouts = layoutTimelineTasks(dayTasks);

            return (
              <div className="timeline-day-column" key={dateKey}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <span className="timeline-hour-line" key={hour} />
                ))}
                {dayTasks.map((task) => {
                  const listName =
                    lists.find((list) => list.id === task.listId)?.name ?? "事项";

                  return (
                    <button
                      className={`timeline-event ${task.timeKind} ${getTimelineDensityClass(task)} ${
                        task.completed ? "completed" : ""
                      } ${selectedEventId === task.id ? "active" : ""}`}
                      key={task.id}
                      style={taskLayouts.get(task.id)}
                      type="button"
                      onClick={() => setSelectedEventId(task.id)}
                      onDoubleClick={() => openEventInTaskList(task)}
                    >
                      <span className="timeline-event-icon">{task.icon}</span>
                      <span className="timeline-event-title">
                        {task.title || "未命名事项"}
                      </span>
                      <span className="timeline-event-time">
                        {formatTaskTime(task)} · {listName}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTaskEditor() {
    if (!selectedEvent) {
      return <p className="empty-state">选择或新增一个事项后编辑详情</p>;
    }

    return (
      <>
        <div className="event-section-title">
          <div>
            <p className="eyebrow">Selected Task</p>
            <h2>{selectedEvent.title || "未命名事项"}</h2>
          </div>
          <div className="event-section-actions">
            <button
              className={`task-check editor-complete-action ${
                selectedEvent.completed ? "checked" : ""
              }`}
              type="button"
              onClick={() => toggleTaskCompleted(selectedEvent)}
              aria-label={selectedEvent.completed ? "取消完成" : "完成事项"}
            >
              {selectedEvent.completed ? <Check size={16} /> : <Circle size={16} />}
            </button>
            <button
              className="danger-action"
              type="button"
              onClick={deleteSelectedEvent}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <label className="field">
          <span>图标</span>
          <div className="emoji-picker">
            {eventIcons.map((icon) => (
              <button
                className={icon === selectedEvent.icon ? "active" : ""}
                key={icon}
                type="button"
                onClick={() => updateSelectedEvent({ icon })}
              >
                {icon}
              </button>
            ))}
            <button
              className={emojiPickerOpen ? "active" : ""}
              type="button"
              onClick={() => {
                setEmojiTarget({ type: "event" });
                setEmojiPickerOpen((open) => !open);
              }}
            >
              +
            </button>
          </div>
        </label>

        <label className="field">
          <span>标题</span>
          <input
            value={selectedEvent.title}
            onChange={(event) =>
              updateSelectedEvent({ title: event.target.value })
            }
          />
        </label>

        <label className="field">
          <span>详情</span>
          <textarea
            value={selectedEvent.detail}
            onChange={(event) =>
              updateSelectedEvent({ detail: event.target.value })
            }
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>日期</span>
            <input
              type="date"
              value={selectedEvent.date}
              onChange={(event) =>
                updateSelectedEvent({ date: event.target.value })
              }
            />
            <button
              className="no-date-button"
              type="button"
              onClick={() => updateSelectedEvent({ date: "" })}
            >
              无日期
            </button>
          </label>
          <label className="field">
            <span>清单</span>
            <select
              value={selectedEvent.listId}
              onChange={(event) =>
                updateSelectedEvent({ listId: event.target.value })
              }
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.icon} {list.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>时间类型</span>
          <select
            value={selectedEvent.timeKind}
            onChange={(event) =>
              updateSelectedEvent({ timeKind: event.target.value as TimeKind })
            }
          >
            <option value="range">开始和结束时间</option>
            <option value="start">只有开始时间</option>
            <option value="none">无时间</option>
          </select>
        </label>

        {selectedEvent.timeKind !== "none" ? (
          <div
            className={
              selectedEvent.timeKind === "range" ? "field-row" : "field-row single"
            }
          >
            <label className="field">
              <span>开始</span>
              <input
                type="time"
                value={selectedEvent.startTime}
                onChange={(event) =>
                  updateSelectedEvent({ startTime: event.target.value })
                }
              />
            </label>
            {selectedEvent.timeKind === "range" ? (
              <label className="field">
                <span>结束</span>
                <input
                  type="time"
                  value={selectedEvent.endTime}
                  onChange={(event) =>
                    updateSelectedEvent({ endTime: event.target.value })
                  }
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="field-row">
          <label className="field">
            <span>优先级</span>
            <select
              value={selectedEvent.priority}
              onChange={(event) =>
                updateSelectedEvent({ priority: event.target.value as Priority })
              }
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>循环</span>
            <select
              value={selectedEvent.recurrence}
              onChange={(event) =>
                updateSelectedEvent({ recurrence: event.target.value as Recurrence })
              }
            >
              {Object.entries(recurrenceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>提醒时间</span>
          <input
            type="datetime-local"
            value={buildReminderValue(selectedEvent)}
            onChange={(event) =>
              updateSelectedEvent({ reminderAt: event.target.value })
            }
          />
        </label>

        <section className="subtask-panel">
          <div className="subtask-header">
            <span>子任务</span>
            <button type="button" onClick={addSubtask}>
              <Plus size={16} />
            </button>
          </div>
          <div className="subtask-list">
            {selectedEvent.subtasks.length === 0 ? (
              <p className="empty-state">暂无子任务</p>
            ) : (
              selectedEvent.subtasks.map((subtask) => (
                <div className="subtask-item" key={subtask.id}>
                  <button
                    className={`task-check ${subtask.completed ? "checked" : ""}`}
                    type="button"
                    onClick={() =>
                      updateSubtask(subtask.id, { completed: !subtask.completed })
                    }
                  >
                    {subtask.completed ? <Check size={14} /> : <Circle size={14} />}
                  </button>
                  <input
                    value={subtask.title}
                    onChange={(event) =>
                      updateSubtask(subtask.id, { title: event.target.value })
                    }
                  />
                  <button type="button" onClick={() => deleteSubtask(subtask.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </>
    );
  }

  function renderEmojiModal() {
    if (!emojiPickerOpen) {
      return null;
    }

    return (
      <div
        className="emoji-modal-backdrop"
        role="presentation"
        onMouseDown={() => setEmojiPickerOpen(false)}
      >
        <section
          className="emoji-modal"
          role="dialog"
          aria-label="选择 emoji 图标"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="emoji-modal-header">
            <div>
              <p className="eyebrow">Emoji Icon</p>
              <h2>选择图标</h2>
            </div>
            <button type="button" onClick={() => setEmojiPickerOpen(false)}>
              关闭
            </button>
          </div>
          <EmojiPicker
            height={520}
            lazyLoadEmojis
            onEmojiClick={(emoji: EmojiClickData) => {
              if (emojiTarget.type === "tag") {
                updateTag(emojiTarget.tagId, { icon: emoji.emoji });
              } else if (emojiTarget.type === "newTag") {
                addTag(emoji.emoji);
              } else if (emojiTarget.type === "list") {
                updateList(emojiTarget.listId, { icon: emoji.emoji });
              } else if (emojiTarget.type === "workflow") {
                updateWorkflowItem(emojiTarget.kind, emojiTarget.itemId, {
                  icon: emoji.emoji
                });
              } else {
                updateSelectedEvent({ icon: emoji.emoji });
              }
              setEmojiPickerOpen(false);
            }}
            previewConfig={{ showPreview: false }}
            searchPlaceHolder="搜索 emoji"
            width="100%"
          />
        </section>
      </div>
    );
  }

  function renderTagPickerModal() {
    if (!tagPickerOpen) {
      return null;
    }

    return (
      <div
        className="emoji-modal-backdrop"
        role="presentation"
        onMouseDown={() => setTagPickerOpen(false)}
      >
        <section
          className="emoji-modal tag-picker-modal"
          role="dialog"
          aria-label="选择标签"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="emoji-modal-header">
            <div>
              <p className="eyebrow">Tag Picker</p>
              <h2>选择标签</h2>
            </div>
            <button type="button" onClick={() => setTagPickerOpen(false)}>
              关闭
            </button>
          </div>
          <div className="tag-picker-grid">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  if (tagPickerTarget === "day") {
                    assignTagToDate(tag.id, selectedDateKey);
                  }
                  setTagPickerOpen(false);
                }}
              >
                <span>{tag.icon}</span>
                <small>{tag.name}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderTagPanel() {
    return (
      <section className="tag-panel" aria-label="标签">
        <div className="tag-list">
          {tags.map((tag) => (
            <div
              className={`tag-chip ${tagDeleteMode ? "delete-mode" : ""} ${
                animatedTagId === tag.id ? "tag-entering" : ""
              } ${tagDeleteAnimatingIds.includes(tag.id) ? "tag-removing" : ""} ${
                draggingTagId === tag.id ? "dragging" : ""
              }`}
              key={tag.id}
              onPointerDown={(event) => {
                if (tagDeleteMode || event.button !== 0) {
                  return;
                }

                pendingTagDragRef.current = {
                  tagId: tag.id,
                  x: event.clientX,
                  y: event.clientY,
                  active: false
                };
              }}
            >
              <button
                className="tag-icon-button"
                type="button"
                onClick={() => {
                  if (suppressNextTagClickRef.current) {
                    return;
                  }
                  setEmojiTarget({ type: "tag", tagId: tag.id });
                  setEmojiPickerOpen(true);
                }}
              >
                {tag.icon}
              </button>
              {tagDeleteMode ? (
                <button
                  className="tag-delete-button"
                  type="button"
                  onClick={() => deleteTag(tag.id)}
                  aria-label="删除标签"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <button
            className="tag-tool-button"
            type="button"
            onClick={() => {
              setEmojiTarget({ type: "newTag" });
              setEmojiPickerOpen(true);
            }}
            aria-label="新增标签"
          >
            <Plus size={18} />
          </button>
          <button
            className={`tag-tool-button ${tagDeleteMode ? "active" : ""}`}
            type="button"
            onClick={() => setTagDeleteMode((mode) => !mode)}
            aria-label="删除标签"
          >
            ×
          </button>
          <span className="tag-title">标签</span>
        </div>
      </section>
    );
  }

  function renderTaskListItem(task: TaskEvent) {
    const list = lists.find((item) => item.id === task.listId);
    return (
      <article
        className={`todo-task ${
          task.id === selectedEventId ? "active" : ""
        } ${task.completed ? "completed" : ""} ${
          task.id === animatedEventId ? "event-entering" : ""
        } ${task.id === completedPulseId ? "complete-pulse" : ""} ${
          eventDeleteAnimatingIds.includes(task.id) ? "event-removing" : ""
        } ${dragOverTaskId === task.id ? "drag-over" : ""}`}
        draggable
        key={task.id}
        onDragStart={() => setDraggingTaskId(task.id)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverTaskId(task.id);
        }}
        onDragLeave={() => {
          if (dragOverTaskId === task.id) {
            setDragOverTaskId("");
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggingTaskId) {
            reorderTask(draggingTaskId, task.id);
          }
          setDraggingTaskId("");
          setDragOverTaskId("");
        }}
        onDragEnd={() => {
          setDraggingTaskId("");
          setDragOverTaskId("");
        }}
      >
        <button
          className={`task-check ${task.completed ? "checked" : ""}`}
          type="button"
          onClick={() => toggleTaskCompleted(task)}
        >
          {task.completed ? <Check size={16} /> : <Circle size={16} />}
        </button>
        <button
          className="todo-task-main"
          type="button"
          onClick={() => handleEventListClick(task)}
          onDoubleClick={() => handleEventListDoubleClick(task)}
        >
          <span className="event-icon">{task.icon}</span>
          <span>
            <strong>{task.title || "未命名事项"}</strong>
            <small>
              {formatTaskDate(task)} · {formatTaskTime(task)}
              {list ? ` · ${list.name}` : ""}
            </small>
          </span>
        </button>
        <span className={`priority-pill ${task.priority}`}>
          <Flag size={13} />
          {priorityLabels[task.priority]}
        </span>
      </article>
    );
  }

  function renderWorkflowItem(item: WorkflowItem, kind: "habit" | "temp") {
    return (
      <article className={`workflow-mini-card ${kind}`} key={item.id}>
        <input
          value={item.name}
          onChange={(event) =>
            updateWorkflowItem(kind, item.id, { name: event.target.value })
          }
          aria-label={kind === "habit" ? "习惯名称" : "临时任务名称"}
        />
        <textarea
          value={item.detail}
          onChange={(event) =>
            updateWorkflowItem(kind, item.id, { detail: event.target.value })
          }
          aria-label={kind === "habit" ? "习惯详情" : "临时任务详情"}
        />
        <button type="button" onClick={() => deleteWorkflowItem(kind, item.id)}>
          <Trash2 size={14} />
        </button>
      </article>
    );
  }

  function renderWorkflowView() {
    return (
      <section className="workflow-workspace">
        <aside className="workflow-current-panel">
          <p className="eyebrow">Current Task</p>
          {workflowCurrentTask ? (
            <article className="workflow-current-card">
              <span className="workflow-current-icon">{workflowCurrentTask.icon}</span>
              <div>
                <h2>{workflowCurrentTask.title}</h2>
                <p>{workflowCurrentTask.detail || "这个任务还没有详情。"}</p>
              </div>
              <dl>
                <div>
                  <dt>日期</dt>
                  <dd>{formatTaskDate(workflowCurrentTask)}</dd>
                </div>
                <div>
                  <dt>时间</dt>
                  <dd>{formatTaskTime(workflowCurrentTask)}</dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{priorityLabels[workflowCurrentTask.priority]}</dd>
                </div>
              </dl>
              <div className="workflow-current-actions">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => toggleTaskCompleted(workflowCurrentTask)}
                >
                  <Check size={16} />
                  完成
                </button>
                <button
                  type="button"
                  onClick={() => openEventInCalendar(workflowCurrentTask)}
                >
                  去日历
                </button>
              </div>
            </article>
          ) : (
            <p className="empty-state">暂时没有当前任务</p>
          )}
        </aside>

        <section className="workflow-board">
          <section className="workflow-panel rough">
            <div className="workflow-panel-title">
              <div>
                <p className="eyebrow">Rough List</p>
                <h2>粗略事项</h2>
              </div>
            </div>
            <div className="workflow-readonly-list">
              {workflowTaskPreview.length === 0 ? (
                <p className="empty-state">没有未完成事项</p>
              ) : (
                workflowTaskPreview.map((task) => (
                  <button
                    className="workflow-readonly-item"
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedEventId(task.id)}
                    onDoubleClick={() => openEventInCalendar(task)}
                  >
                    <span>{task.icon}</span>
                    <strong>{task.title}</strong>
                    <small>
                      {formatTaskDate(task)} · {formatTaskTime(task)}
                    </small>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="workflow-panel habits">
            <div className="workflow-panel-title">
              <div>
                <p className="eyebrow">Habits</p>
                <h2>习惯列表</h2>
              </div>
              <button type="button" onClick={() => addWorkflowItem("habit")}>
                <Plus size={16} />
              </button>
            </div>
            <div className="workflow-mini-list">
              {habits.map((item) => renderWorkflowItem(item, "habit"))}
            </div>
          </section>

          <section className="workflow-panel temporary">
            <div className="workflow-panel-title">
              <div>
                <p className="eyebrow">Temporary</p>
                <h2>临时任务</h2>
              </div>
              <button type="button" onClick={() => addWorkflowItem("temp")}>
                <Plus size={16} />
              </button>
            </div>
            <div className="workflow-mini-list">
              {tempTasks.map((item) => renderWorkflowItem(item, "temp"))}
            </div>
          </section>
        </section>
      </section>
    );
  }

  function renderWorkflowSourceItem(
    sourceKind: WorkflowSourceKind,
    source: TaskEvent | WorkflowItem
  ) {
    const card = createWorkflowCardFromSource(sourceKind, source);
    const isTask = sourceKind === "task";
    const title = isTask ? (source as TaskEvent).title : (source as WorkflowItem).name;
    const detail = isTask ? (source as TaskEvent).detail : (source as WorkflowItem).detail;
    const icon = isTask ? (source as TaskEvent).icon : (source as WorkflowItem).icon;

    return (
      <article
        className={`workflow-source-card ${sourceKind} ${
          draggingWorkflowSource?.sourceKind === sourceKind &&
          draggingWorkflowSource.sourceId === source.id
            ? "is-copying"
            : ""
        }`}
        key={`${sourceKind}-${source.id}`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          pendingWorkflowDragRef.current = {
            sourceCard: card,
            x: event.clientX,
            y: event.clientY,
            active: false
          };
        }}
        onDoubleClick={() => openWorkflowSourceEditor(sourceKind, source.id)}
      >
        <span className="workflow-card-icon">{icon}</span>
        <span className="workflow-card-copy">
          <strong>{title || "未命名卡片"}</strong>
          {isTask ? <small>{detail || "拖入左侧工作流"}</small> : null}
        </span>
        {sourceKind !== "task" ? (
          <button
            type="button"
            onClick={() => deleteWorkflowItem(sourceKind, source.id)}
            onDragStart={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="删除来源"
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </article>
    );
  }

  function renderWorkflowEditableItem(item: WorkflowItem, kind: "habit" | "temp") {
    return renderWorkflowSourceItem(kind, item);
  }

  function renderWorkflowQueueCard(card: WorkflowCard) {
    const sourceTask =
      card.sourceKind === "task"
        ? tasks.find((task) => task.id === card.sourceId)
        : null;
    const timeLabel =
      sourceTask && sourceTask.timeKind !== "none"
        ? formatTaskTime(sourceTask)
        : card.timeLabel;

    return (
      <article
        className={`workflow-card priority-${card.priority} ${
          dragOverWorkflowCardId === card.id && draggingWorkflowCardId !== card.id
            ? "drag-over"
            : ""
        } ${
          dragOverWorkflowCardId === card.id && draggingWorkflowCardId !== card.id
            ? `insert-${workflowInsertPosition}`
            : ""
        } ${
          draggingWorkflowCardId === card.id ? "is-moving" : ""
        }`}
        data-workflow-card-id={card.id}
        key={card.id}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          pendingWorkflowDragRef.current = {
            cardId: card.id,
            x: event.clientX,
            y: event.clientY,
            active: false
          };
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = draggingWorkflowCardIdRef.current
            ? "move"
            : "copy";
          const insertPosition =
            event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2
              ? "before"
              : "after";
          setDragOverWorkflowCardId(card.id);
          setWorkflowInsertPosition(insertPosition);
        }}
        onDragLeave={() => {
          if (dragOverWorkflowCardId === card.id) {
            setDragOverWorkflowCardId("");
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const movingCardId = readWorkflowCardDragId(event);
          const sourceCard = readWorkflowSourceDragData(event);
          const insertPosition =
            event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2
              ? "before"
              : "after";
          if (movingCardId) {
            reorderWorkflowCard(movingCardId, card.id, insertPosition);
          } else if (sourceCard) {
            addWorkflowCard(sourceCard, { targetId: card.id, position: insertPosition });
          }
          resetWorkflowDragState();
        }}
        onDragEnd={resetWorkflowDragState}
      >
        <button
          className="task-check"
          type="button"
          onClick={() => completeWorkflowCard(card)}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={
            card.sourceKind === "task"
              ? "完成事项"
              : card.sourceKind === "temp"
                ? "完成并删除临时任务"
                : "完成本次习惯"
          }
        >
          <Circle size={16} />
        </button>
        <span className="workflow-card-icon">{card.icon}</span>
        <span className="workflow-card-copy">
          <span className="workflow-card-title-row">
            <strong>{card.title}</strong>
            {card.sourceKind === "task" && timeLabel ? (
              <time>{timeLabel}</time>
            ) : null}
          </span>
          <small>{card.detail || "无详情"}</small>
        </span>
        <select
          className={`workflow-priority-select ${card.priority}`}
          value={card.priority}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) =>
            updateWorkflowCard(card.id, {
              priority: event.target.value as Priority
            })
          }
          aria-label="工作流优先级"
        >
          <option value="none">无</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <button
          type="button"
          onClick={() => deleteWorkflowCard(card.id)}
          onDragStart={(event) => event.preventDefault()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Trash2 size={14} />
        </button>
      </article>
    );
  }

  function renderWaitingWorkflowCard(card: WaitingWorkflowCard) {
    return (
      <article
        className={`workflow-waiting-card priority-${card.priority}`}
        key={card.id}
      >
        <div className="workflow-waiting-main">
          <span className="workflow-card-icon">{card.icon}</span>
          <span className="workflow-card-copy">
            <strong>{card.title}</strong>
            <small>{card.detail || "等待到点后加入工作流"}</small>
          </span>
          <button
            type="button"
            onClick={() => deleteWaitingWorkflowCard(card.id)}
            onDragStart={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="workflow-waiting-controls">
          <label>
            等到
            <input
              type="datetime-local"
              value={toDateTimeInputValue(card.waitUntil)}
              onChange={(event) =>
                updateWaitingWorkflowCard(card.id, {
                  waitUntil: fromDateTimeInputValue(event.target.value)
                })
              }
            />
          </label>
          <label>
            加入
            <select
              value={card.insertPosition}
              onChange={(event) =>
                updateWaitingWorkflowCard(card.id, {
                  insertPosition: event.target.value === "head" ? "head" : "tail"
                })
              }
            >
              <option value="tail">队尾</option>
              <option value="head">队头</option>
            </select>
          </label>
          <label>
            优先级
            <select
              value={card.priority}
              onChange={(event) =>
                updateWaitingWorkflowCard(card.id, {
                  priority: event.target.value as Priority
                })
              }
            >
              <option value="none">无</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
        </div>
      </article>
    );
  }

  function renderWaitingSettingsModal() {
    if (!pendingWaitingCard) {
      return null;
    }

    return (
      <div
        className="emoji-modal-backdrop"
        role="presentation"
        onMouseDown={() => setPendingWaitingCard(null)}
      >
        <section
          className="waiting-settings-modal"
          role="dialog"
          aria-label="设置等待时间"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="waiting-settings-header">
            <div>
              <p className="eyebrow">Waiting</p>
              <h2>{pendingWaitingCard.card.title}</h2>
            </div>
            <button type="button" onClick={() => setPendingWaitingCard(null)}>
              <X size={18} />
            </button>
          </div>

          <div className="waiting-mode-switch" role="group" aria-label="等待方式">
            <button
              className={waitingMode === "duration" ? "active" : ""}
              type="button"
              onClick={() => setWaitingMode("duration")}
            >
              等待时长
            </button>
            <button
              className={waitingMode === "endTime" ? "active" : ""}
              type="button"
              onClick={() => setWaitingMode("endTime")}
            >
              结束时间
            </button>
          </div>

          {waitingMode === "duration" ? (
            <label className="waiting-setting-field">
              等待分钟数
              <input
                type="number"
                min="1"
                step="1"
                value={waitingMinutes}
                onChange={(event) =>
                  setWaitingMinutes(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </label>
          ) : (
            <label className="waiting-setting-field">
              等待结束时间
              <input
                type="datetime-local"
                value={waitingEndTime}
                onChange={(event) => setWaitingEndTime(event.target.value)}
              />
            </label>
          )}

          <label className="waiting-setting-field">
            到期后加入
            <select
              value={waitingInsertPosition}
              onChange={(event) =>
                setWaitingInsertPosition(event.target.value === "head" ? "head" : "tail")
              }
            >
              <option value="tail">工作流队尾</option>
              <option value="head">工作流队头</option>
            </select>
          </label>

          <div className="waiting-settings-actions">
            <button type="button" onClick={() => setPendingWaitingCard(null)}>
              取消
            </button>
            <button className="primary-action" type="button" onClick={confirmWaitingSettings}>
              确认等待
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderWorkflowSourceEditorModal() {
    if (!workflowEditorTarget) {
      return null;
    }

    const { sourceKind, sourceId } = workflowEditorTarget;
    const workflowItem =
      sourceKind === "habit"
        ? habits.find((item) => item.id === sourceId)
        : sourceKind === "temp"
          ? tempTasks.find((item) => item.id === sourceId)
          : null;

    return (
      <div
        className="emoji-modal-backdrop"
        role="presentation"
        onMouseDown={() => setWorkflowEditorTarget(null)}
      >
        <section
          className={`workflow-source-editor-modal ${sourceKind}`}
          role="dialog"
          aria-label="编辑工作流来源"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="workflow-source-editor-header">
            <div>
              <p className="eyebrow">
                {sourceKind === "task"
                  ? "事项"
                  : sourceKind === "habit"
                    ? "习惯"
                    : "临时任务"}
              </p>
              <h2>编辑详情</h2>
            </div>
            <button type="button" onClick={() => setWorkflowEditorTarget(null)}>
              <X size={18} />
            </button>
          </div>

          {sourceKind === "task" ? (
            renderTaskEditor()
          ) : workflowItem ? (
            <div className="workflow-source-editor-fields">
              <div className="workflow-icon-field">
                <span>图标</span>
                <div className="icon-grid">
                  {eventIcons.slice(0, 8).map((icon) => (
                    <button
                      className={workflowItem.icon === icon ? "active" : ""}
                      key={icon}
                      type="button"
                      onClick={() =>
                        updateWorkflowItem(sourceKind, sourceId, { icon })
                      }
                    >
                      {icon}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setEmojiTarget({
                        type: "workflow",
                        kind: sourceKind,
                        itemId: sourceId
                      });
                      setEmojiPickerOpen(true);
                    }}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </div>
              <label>
                名称
                <input
                  value={workflowItem.name}
                  onChange={(event) =>
                    updateWorkflowItem(sourceKind, sourceId, {
                      name: event.target.value
                    })
                  }
                />
              </label>
              <label>
                详情
                <textarea
                  value={workflowItem.detail}
                  onChange={(event) =>
                    updateWorkflowItem(sourceKind, sourceId, {
                      detail: event.target.value
                    })
                  }
                />
              </label>
              <button
                className="workflow-source-delete"
                type="button"
                onClick={() => {
                  deleteWorkflowItem(sourceKind, sourceId);
                  setWorkflowEditorTarget(null);
                }}
              >
                <Trash2 size={15} />
                删除
              </button>
            </div>
          ) : (
            <p className="empty-state">这个条目已经不存在</p>
          )}
        </section>
      </div>
    );
  }

  function renderWorkflowBoardView() {
    const workflowTaskSources = tasks
      .filter((task) => !task.completed)
      .sort((a, b) => compareTaskDate(a, b) || compareTaskTime(a, b));
    const orderedWorkflowCards = [...workflowCards].sort((a, b) => a.order - b.order);
    const orderedWaitingCards = [...waitingWorkflowCards].sort(
      (a, b) => a.order - b.order
    );

    return (
      <section
        className={`workflow-workspace modern ${
          draggingWorkflowPreview ? "is-dragging" : ""
        }`}
      >
        <aside className="workflow-lane">
          <section
            className={`workflow-drop-panel queue ${
              workflowDropTarget === "queue" ? "drop-active" : ""
            } ${
              workflowDropTarget === "queue" && !dragOverWorkflowCardId
                ? "tail-drop-active"
                : ""
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = draggingWorkflowCardIdRef.current
                ? "move"
                : "copy";
              setWorkflowDropTarget("queue");
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = draggingWorkflowCardIdRef.current
                ? "move"
                : "copy";
              setWorkflowDropTarget("queue");
              if (
                !(event.target as HTMLElement).closest(
                  ".workflow-card[data-workflow-card-id]"
                )
              ) {
                setDragOverWorkflowCardId("");
              }
            }}
            onDragLeave={() => {
              if (workflowDropTarget === "queue") {
                setWorkflowDropTarget("");
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleWorkflowQueueDrop(event);
            }}
          >
            <div className="workflow-panel-title">
              <div>
                <p className="eyebrow">Workflow</p>
                <h2>当前工作流</h2>
              </div>
            </div>
            <div className="workflow-card-list">
              {orderedWorkflowCards.length === 0 ? (
                <p className="empty-state">从右侧拖入事项、临时任务或习惯</p>
              ) : (
                orderedWorkflowCards.map(renderWorkflowQueueCard)
              )}
            </div>
          </section>

          <section
            className={`workflow-drop-panel waiting ${
              workflowDropTarget === "waiting" ? "drop-active" : ""
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setWorkflowDropTarget("waiting");
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setWorkflowDropTarget("waiting");
            }}
            onDragLeave={() => {
              if (workflowDropTarget === "waiting") {
                setWorkflowDropTarget("");
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleWorkflowWaitingDrop(event);
            }}
          >
            <div className="workflow-panel-title">
              <div>
                <p className="eyebrow">Waiting</p>
                <h2>等待区</h2>
              </div>
            </div>
            <div className="workflow-card-list">
              {orderedWaitingCards.length === 0 ? (
                <p className="empty-state">拖到这里后设置等待时间</p>
              ) : (
                orderedWaitingCards.map(renderWaitingWorkflowCard)
              )}
            </div>
          </section>
        </aside>

        <section className="workflow-source-board">
          <section className="workflow-panel rough">
            <div className="workflow-panel-title">
              <div>
                <h2>事项</h2>
              </div>
            </div>
            <div className="workflow-readonly-list">
              {workflowTaskSources.length === 0 ? (
                <p className="empty-state">没有未完成事项</p>
              ) : (
                workflowTaskSources.map((task) => renderWorkflowSourceItem("task", task))
              )}
            </div>
          </section>

          <section className="workflow-panel temporary">
            <div className="workflow-panel-title">
              <div>
                <h2>临时任务</h2>
              </div>
              <button type="button" onClick={() => addWorkflowItem("temp")}>
                <Plus size={16} />
              </button>
            </div>
            <div className="workflow-mini-list">
              {tempTasks.map((item) => renderWorkflowEditableItem(item, "temp"))}
            </div>
          </section>

          <section className="workflow-panel habits">
            <div className="workflow-panel-title">
              <div>
                <h2>习惯</h2>
              </div>
              <button type="button" onClick={() => addWorkflowItem("habit")}>
                <Plus size={16} />
              </button>
            </div>
            <div className="workflow-mini-list">
              {habits.map((item) => renderWorkflowEditableItem(item, "habit"))}
            </div>
          </section>
        </section>
      </section>
    );
  }

  function renderCodexDetectorView() {
    const detectorDisplay = resolveCodexStatusDisplay(codexDetectorStatus);
    const match = codexDetectorStatus.match;
    const computedDetectorScale = computeCodexDetectorScale(codexDetectorSettings);
    const templateResolutionValue = `${codexDetectorSettings.templateWidth}x${codexDetectorSettings.templateHeight}`;
    const screenResolutionValue = `${codexDetectorSettings.screenWidth}x${codexDetectorSettings.screenHeight}`;

    return (
      <section className="codex-control-workspace">
        <article className="codex-control-panel">
          <div className="codex-control-copy">
            <p className="eyebrow">Codex Detector</p>
            <h2>工作状态检测</h2>
            <p>
              开启后，M App 启动时会自动运行内置屏幕识别，并用悬浮红绿灯显示 Codex
              是否正在工作。
            </p>
          </div>
          <button
            className={`codex-detector-switch ${
              codexDetectorEnabled ? "active" : ""
            }`}
            type="button"
            onClick={toggleCodexDetector}
            disabled={codexDetectorSaving}
            aria-pressed={codexDetectorEnabled}
          >
            <span className="detector-switch-light" aria-hidden="true" />
            <span>{codexDetectorEnabled ? "开启" : "关闭"}</span>
          </button>
          <div className="codex-detector-status">
            <strong>
              {codexDetectorEnabled ? "下次启动自动检测" : "下次启动不检测"}
            </strong>
            <small>{codexDetectorSaving ? "正在保存..." : "设置已记忆"}</small>
          </div>

          <section className="codex-scale-panel">
            <div className="codex-scale-title">
              <div>
                <p className="eyebrow">Match Scale</p>
                <h3>匹配分辨率与缩放</h3>
              </div>
              <strong>{computedDetectorScale.toFixed(2)}×</strong>
            </div>
            <div className="codex-scale-grid">
              <label>
                模板图片分辨率
                <select
                  value={
                    codexResolutionPresets.some(
                      (preset) =>
                        preset.width === codexDetectorSettings.templateWidth &&
                        preset.height === codexDetectorSettings.templateHeight
                    )
                      ? templateResolutionValue
                      : "custom"
                  }
                  onChange={(event) => {
                    const preset = codexResolutionPresets.find(
                      (item) => `${item.width}x${item.height}` === event.target.value
                    );
                    if (preset && preset.width > 0) {
                      saveCodexDetectorSettings({
                        templateWidth: preset.width,
                        templateHeight: preset.height
                      });
                    }
                  }}
                >
                  {codexResolutionPresets.map((preset) => (
                    <option
                      key={`template-${preset.label}`}
                      value={preset.width > 0 ? `${preset.width}x${preset.height}` : "custom"}
                    >
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模板缩放
                <select
                  value={codexDetectorSettings.templateScalePercent}
                  onChange={(event) =>
                    saveCodexDetectorSettings({
                      templateScalePercent: Number(event.target.value)
                    })
                  }
                >
                  {codexScalePresets.map((scale) => (
                    <option key={`template-scale-${scale}`} value={scale}>
                      {scale}%
                    </option>
                  ))}
                </select>
              </label>
              <label>
                当前屏幕分辨率
                <select
                  value={
                    codexResolutionPresets.some(
                      (preset) =>
                        preset.width === codexDetectorSettings.screenWidth &&
                        preset.height === codexDetectorSettings.screenHeight
                    )
                      ? screenResolutionValue
                      : "custom"
                  }
                  onChange={(event) => {
                    const preset = codexResolutionPresets.find(
                      (item) => `${item.width}x${item.height}` === event.target.value
                    );
                    if (preset && preset.width > 0) {
                      saveCodexDetectorSettings({
                        screenWidth: preset.width,
                        screenHeight: preset.height
                      });
                    }
                  }}
                >
                  {codexResolutionPresets.map((preset) => (
                    <option
                      key={`screen-${preset.label}`}
                      value={preset.width > 0 ? `${preset.width}x${preset.height}` : "custom"}
                    >
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                当前缩放
                <select
                  value={codexDetectorSettings.screenScalePercent}
                  onChange={(event) =>
                    saveCodexDetectorSettings({
                      screenScalePercent: Number(event.target.value)
                    })
                  }
                >
                  {codexScalePresets.map((scale) => (
                    <option key={`screen-scale-${scale}`} value={scale}>
                      {scale}%
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="codex-custom-resolution">
              <label>
                模板宽
                <input
                  min={1}
                  type="number"
                  value={codexDetectorSettings.templateWidth}
                  onChange={(event) =>
                    saveCodexDetectorSettings({ templateWidth: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                模板高
                <input
                  min={1}
                  type="number"
                  value={codexDetectorSettings.templateHeight}
                  onChange={(event) =>
                    saveCodexDetectorSettings({ templateHeight: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                屏幕宽
                <input
                  min={1}
                  type="number"
                  value={codexDetectorSettings.screenWidth}
                  onChange={(event) =>
                    saveCodexDetectorSettings({ screenWidth: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                屏幕高
                <input
                  min={1}
                  type="number"
                  value={codexDetectorSettings.screenHeight}
                  onChange={(event) =>
                    saveCodexDetectorSettings({ screenHeight: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </section>

          <section className="codex-match-panel">
            <div className="codex-match-header">
              <div>
                <p className="eyebrow">实时检测结果</p>
                <h3>{detectorDisplay.label}</h3>
              </div>
              <span className={`codex-match-status ${detectorDisplay.status}`}>
                {codexDetectorEnabled ? detectorDisplay.message : "检测已关闭"}
              </span>
            </div>

            {match && codexMatchImageUrl ? (
              <div className="codex-match-content">
                <div className="codex-match-image-wrap">
                  <img src={codexMatchImageUrl} alt={`匹配区域：${match.label}`} />
                </div>
                <dl className="codex-match-meta">
                  <div>
                    <dt>识别类型</dt>
                    <dd>{match.label}</dd>
                  </div>
                  <div>
                    <dt>显示器</dt>
                    <dd>第 {match.screenIndex + 1} 块屏幕</dd>
                  </div>
                  <div>
                    <dt>屏幕坐标</dt>
                    <dd>
                      {match.x}, {match.y}
                    </dd>
                  </div>
                  <div>
                    <dt>匹配尺寸</dt>
                    <dd>
                      {match.width} × {match.height}
                    </dd>
                  </div>
                  <div>
                    <dt>OpenCV 相似度</dt>
                    <dd>{((match.confidence ?? 1 - match.score / 100) * 100).toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>缩放比例</dt>
                    <dd>{match.scale == null ? "-" : `${match.scale.toFixed(1)}×`}</dd>
                  </div>
                  <div>
                    <dt>连续帧</dt>
                    <dd>{match.consecutiveFrames ?? "-"}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="codex-match-empty">
                <Search size={22} />
                <span>{codexDetectorEnabled ? "当前屏幕未匹配到状态标志" : "开启检测后显示命中区域"}</span>
              </div>
            )}
          </section>
        </article>
      </section>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <AppWindow size={24} />
          <span>M App</span>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <button
            className={`nav-item ${view === "calendar" ? "active" : ""}`}
            type="button"
            onClick={() => setView("calendar")}
          >
            <CalendarDays size={18} />
            <span>日历</span>
          </button>
          <button
            className={`nav-item ${view === "events" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setSelectedEventId("");
              setView("events");
            }}
          >
            <ListTodo size={18} />
            <span>事项列表</span>
          </button>
          <button
            className={`nav-item ${view === "workflow" ? "active" : ""}`}
            type="button"
            onClick={() => setView("workflow")}
          >
            <Workflow size={18} />
            <span>工作流</span>
          </button>
          <button
            className={`nav-item ${view === "codex" ? "active" : ""}`}
            type="button"
            onClick={() => setView("codex")}
          >
            <CodexNavIcon size={18} />
            <span>状态检测</span>
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Personal Workspace</p>
              <h1>{title}</h1>
              <p className="subtitle">{subtitle}</p>
            </div>
            {view === "calendar" ? (
              <button
                className={`detail-switch ${
                  calendarMode === "detail" ? "active" : ""
                }`}
                type="button"
                onClick={() =>
                  setCalendarMode((mode) =>
                    mode === "month" ? "detail" : "month"
                  )
                }
              >
                <span>详细</span>
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </button>
            ) : null}
          </div>
          {view === "calendar" ? (
            renderTagPanel()
          ) : (
            <div className="save-status">
              <Bell size={16} />
              <span>{saveStatus}</span>
            </div>
          )}
        </header>

        {draggingTag ? (
          <div
            className="tag-drag-preview"
            style={{
              left: dragPointerPosition.x,
              top: dragPointerPosition.y
            }}
            aria-hidden="true"
          >
            {draggingTag.icon}
          </div>
        ) : null}
        {draggingWorkflowPreview ? (
          <div
            className="workflow-drag-preview"
            style={{
              left: dragPointerPosition.x,
              top: dragPointerPosition.y
            }}
            aria-hidden="true"
          >
            <span>{draggingWorkflowPreview.icon}</span>
            <strong>{draggingWorkflowPreview.title}</strong>
            <small>{draggingWorkflowCardId ? "移动" : "复制"}</small>
          </div>
        ) : null}
        {toast ? <div className="toast">{toast}</div> : null}

        {view === "calendar" ? (
          <section className="panel calendar-panel">
            <div className="month-header">
              <div className="month-title">
                <div className="month-title-popover" ref={monthTitleRef}>
                  <button
                    className="month-title-button"
                    type="button"
                    onClick={() => setMonthPickerOpen((open) => !open)}
                  >
                    {visibleDate.getFullYear()} 年 {visibleDate.getMonth() + 1} 月
                  </button>
                  {monthPickerOpen ? (
                    <div className="month-picker" role="dialog" aria-label="选择年月">
                      <div className="year-picker">
                        <button type="button" onClick={() => changeMonth(-12)}>
                          <ChevronLeft size={18} />
                        </button>
                        <strong>{visibleDate.getFullYear()} 年</strong>
                        <button type="button" onClick={() => changeMonth(12)}>
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <div className="month-grid">
                        {Array.from({ length: 12 }, (_, index) => (
                          <button
                            className={
                              index === visibleDate.getMonth() ? "selected" : ""
                            }
                            key={index}
                            type="button"
                            onClick={() => selectMonth(index)}
                          >
                            {index + 1} 月
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="month-actions" aria-label="回到今天">
                  <button type="button" onClick={selectToday}>
                    <LocateFixed size={16} />
                    今天
                  </button>
                </div>
              </div>
              <div className="status">
                <CheckCircle2 size={18} />
                <span>
                  {isCurrentMonth ? `今天 ${today.getDate()} 日` : "查看其他月份"}
                </span>
              </div>
            </div>

            <div className="calendar-content">
              <div
                className={`unified-calendar ${calendarMode}`}
                onMouseDown={(event) => {
                  mouseStartY.current = event.clientY;
                }}
                onMouseLeave={() => {
                  mouseStartY.current = null;
                }}
                onMouseUp={handleMouseUp}
                onTouchEnd={handleTouchEnd}
                onTouchStart={(event) => {
                  touchStartY.current = event.touches[0].clientY;
                }}
              >
                <div className="weekday-grid">
                  {weekLabels.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>

                <div
                  className={`calendar-grid slide-${slideDirection}`}
                  key={calendarKey}
                >
                  {calendarRows.map((row, rowIndex) => {
                    const isSelectedWeek = rowIndex === selectedWeekIndex;
                    return (
                      <div
                        className={`calendar-row-wrap ${
                          isSelectedWeek ? "selected-week-wrap" : ""
                        }`}
                        key={row.map((day) => day.date.toISOString()).join("-")}
                      >
                        <div
                          className={`calendar-row ${
                            isSelectedWeek ? "selected-week" : ""
                          }`}
                        >
                          {row.map((day) => renderDayButton(day, isSelectedWeek))}
                        </div>
                        {isSelectedWeek ? (
                          <div className="linear-agenda-wrap">
                            {renderTimelineAgenda(row)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="event-sidebar">
                {selectedDateTags.length > 0 ? (
                  <section className="event-tags-panel">
                    <div className="day-tag-toolbar">
                      {selectedDateTags.map((tag) => (
                        <div
                          className={`day-tag-chip ${
                            dayTagDeleteMode ? "delete-mode" : ""
                          } ${
                            animatedDateTagKey === `${selectedDateKey}-${tag.id}`
                              ? "tag-entering"
                              : ""
                          }`}
                          key={tag.id}
                          title={tag.name}
                        >
                          <span>{tag.icon}</span>
                          {dayTagDeleteMode ? (
                            <button
                              type="button"
                              onClick={() =>
                                removeTagFromDate(tag.id, selectedDateKey)
                              }
                              aria-label="删除当天标签"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <button
                        className="tag-tool-button"
                        type="button"
                        onClick={() => {
                          setTagPickerTarget("day");
                          setTagPickerOpen(true);
                        }}
                        aria-label="添加当天标签"
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        className={`tag-tool-button ${
                          dayTagDeleteMode ? "active" : ""
                        }`}
                        type="button"
                        onClick={() => setDayTagDeleteMode((mode) => !mode)}
                        aria-label="删除当天标签"
                      >
                        ×
                      </button>
                    </div>
                  </section>
                ) : null}
                <section className="event-summary">
                  <div className="event-section-title">
                    <h2>
                      {selectedDate.month + 1}月{selectedDate.day}日事项
                    </h2>
                    <div className="event-section-actions">
                      <button type="button" onClick={() => addEvent()}>
                        <Plus size={16} />
                      </button>
                      <button
                        className="danger-action"
                        type="button"
                        onClick={deleteSelectedEvent}
                        disabled={!selectedEvent}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="event-card-list">
                    {dayEvents.length === 0 ? (
                      <p className="empty-state">今天还没有事项</p>
                    ) : (
                      dayEvents.map((event) => (
                        <button
                          className={`event-card ${
                            event.id === selectedEvent?.id ? "active" : ""
                          } ${event.completed ? "completed" : ""} ${
                            event.id === animatedEventId ? "event-entering" : ""
                          } ${
                            eventDeleteAnimatingIds.includes(event.id)
                              ? "event-removing"
                              : ""
                          }`}
                          key={event.id}
                          type="button"
                          onClick={() => setSelectedEventId(event.id)}
                          onDoubleClick={() => openEventInTaskList(event)}
                        >
                          <span className="event-icon">{event.icon}</span>
                          <span>
                            <strong>{event.title}</strong>
                            <small>
                              {event.completed ? "已完成 · " : ""}
                              {formatTaskTime(event)}
                            </small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="event-detail" key={selectedEvent?.id ?? "empty"}>
                  {renderTaskEditor()}
                </section>
              </aside>
            </div>

            {renderEmojiModal()}
            {renderTagPickerModal()}
          </section>
        ) : view === "events" ? (
          <section className="todo-workspace">
            <aside className="todo-lists-panel">
              <div className="todo-panel-title">
                <strong>智能清单</strong>
              </div>
              <div className="smart-list-group">
                {smartLists.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={selectedListId === item.id ? "active" : ""}
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedListId(item.id)}
                    >
                      <Icon size={17} />
                      <span>{item.name}</span>
                      <small>{smartCounts[item.id]}</small>
                    </button>
                  );
                })}
              </div>

              <div className="todo-panel-title">
                <strong>我的清单</strong>
                <button type="button" onClick={addList}>
                  <Plus size={16} />
                </button>
              </div>
              <div className="custom-list-group">
                {lists.map((list) => (
                  <div
                    className={`custom-list-row ${
                      selectedListId === list.id ? "active" : ""
                    }`}
                    key={list.id}
                  >
                    <button
                      className="list-select"
                      type="button"
                      onClick={() => setSelectedListId(list.id)}
                    >
                      <span>{list.icon}</span>
                      <input
                        value={list.name}
                        onChange={(event) =>
                          updateList(list.id, { name: event.target.value })
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmojiTarget({ type: "list", listId: list.id });
                        setEmojiPickerOpen(true);
                      }}
                    >
                      {list.icon}
                    </button>
                    {list.id !== "inbox" ? (
                      <button type="button" onClick={() => deleteList(list.id)}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </aside>

            <section className="todo-main-panel">
              <div className="todo-main-header">
                <div>
                  <p className="eyebrow">Tasks</p>
                  <h2>{selectedList?.name ?? smartLists.find((item) => item.id === selectedListId)?.name}</h2>
                </div>
                <button className="primary-action" type="button" onClick={() => addEvent()}>
                  <Plus size={18} />
                  新增
                </button>
              </div>
              <div className="quick-add">
                <Plus size={16} />
                <input
                  placeholder="快速新增事项"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.currentTarget.value.trim()) {
                      addEvent({ title: event.currentTarget.value.trim() });
                      event.currentTarget.value = "";
                    }
                  }}
                />
              </div>
              <div className="todo-toolbar">
                <label>
                  <Search size={16} />
                  <input
                    placeholder="搜索事项"
                    value={taskSearch}
                    onChange={(event) => setTaskSearch(event.target.value)}
                  />
                </label>
                <select
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(event.target.value as "time" | "priority" | "manual")
                  }
                >
                  <option value="time">按时间</option>
                  <option value="priority">按优先级</option>
                  <option value="manual">手动排序</option>
                </select>
              </div>
              <div className="todo-task-list" key={selectedListId}>
                {filteredTasks.length === 0 ? (
                  <p className="empty-state">这个清单里暂时没有事项</p>
                ) : (
                  filteredTasks.map(renderTaskListItem)
                )}
              </div>
            </section>

            <aside className="todo-detail-panel" key={selectedEvent?.id ?? "empty"}>
              {renderTaskEditor()}
            </aside>
            {renderEmojiModal()}
          </section>
        ) : view === "workflow" ? (
          <>
            {renderWorkflowBoardView()}
            {renderWaitingSettingsModal()}
            {renderWorkflowSourceEditorModal()}
            {renderEmojiModal()}
          </>
        ) : (
          renderCodexDetectorView()
        )}
      </section>
    </main>
  );
}

export default App;

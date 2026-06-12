import { invoke } from "@tauri-apps/api/core";
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
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type View = "calendar" | "events";
type CalendarMode = "month" | "detail";
type SlideDirection = "up" | "down";
type Priority = "none" | "low" | "medium" | "high";
type Recurrence = "none" | "daily" | "weekly" | "monthly";
type TimeKind = "range" | "start" | "none";
type SmartListId = "today" | "upcoming" | "important" | "completed" | "all";
type SelectedListId = SmartListId | string;

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

type AppData = {
  schemaVersion: number;
  tasks: TaskEvent[];
  lists: TaskList[];
  tags: CalendarTag[];
  tagAssignments: Record<string, string[]>;
  notifiedReminderIds: string[];
};

type EmojiTarget =
  | { type: "event" }
  | { type: "tag"; tagId: string }
  | { type: "newTag" }
  | { type: "list"; listId: string };
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

function createTask(overrides: Partial<TaskEvent> = {}): TaskEvent {
  const timestamp = nowIso();
  return {
    id: createId("task"),
    date: formatDateKey(new Date()),
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
    date: task.date ?? formatDateKey(new Date()),
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

function normalizeData(data: Partial<AppData> | null | undefined): AppData {
  if (!data || !Array.isArray(data.tasks)) {
    return {
      schemaVersion: 1,
      tasks: initialTasks,
      lists: initialLists,
      tags: initialTags,
      tagAssignments: {},
      notifiedReminderIds: []
    };
  }

  return {
    schemaVersion: 1,
    tasks: data.tasks.map(normalizeTask),
    lists: Array.isArray(data.lists) && data.lists.length > 0 ? data.lists : initialLists,
    tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags : initialTags,
    tagAssignments: data.tagAssignments ?? {},
    notifiedReminderIds: data.notifiedReminderIds ?? []
  };
}

function App() {
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
  const [slideDirection, setSlideDirection] = useState<SlideDirection>("up");
  const [calendarKey, setCalendarKey] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("正在读取数据...");
  const [toast, setToast] = useState("");
  const monthTitleRef = useRef<HTMLDivElement>(null);
  const dayClickTimerRef = useRef<number | null>(null);
  const eventClickTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingTagDragRef = useRef<{
    tagId: string;
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
  const todayKey = useMemo(() => formatDateKey(today), [today]);

  const dayEvents = useMemo(() => {
    return tasks
      .filter((event) => event.date === selectedDateKey)
      .sort((a, b) => compareTaskTime(a, b));
  }, [tasks, selectedDateKey]);

  const openTaskCountByDate = useMemo(() => {
    return tasks.reduce<Record<string, number>>((counts, task) => {
      if (!task.completed) {
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
          return task.date >= todayKey && task.date <= nextWeekKey && !task.completed;
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
          return rank[a.priority] - rank[b.priority] || a.date.localeCompare(b.date);
        }
        if (sortMode === "manual") {
          return a.order - b.order;
        }
        const dateCompare = a.date.localeCompare(b.date);
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
        (task) => task.date >= todayKey && task.date <= nextWeekKey && !task.completed
      ).length,
      important: tasks.filter((task) => task.priority === "high" && !task.completed).length,
      completed: tasks.filter((task) => task.completed).length,
      all: tasks.length
    };
  }, [tasks, today, todayKey]);

  const title = view === "calendar" ? "日历" : "事项列表";
  const subtitle =
    view === "calendar" ? "查看本月安排和日期状态" : "按清单、时间和优先级管理全部事项";
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
        notifiedReminderIds
      };
      invoke("save_app_data", { data: payload })
        .then(() => setSaveStatus("已保存"))
        .catch(() => setSaveStatus("保存失败"));
    }, 500);
  }, [dataLoaded, lists, notifiedReminderIds, tagAssignments, tags, tasks]);

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

    function handlePointerMove(event: PointerEvent) {
      const pendingDrag = pendingTagDragRef.current;
      if (!pendingDrag || tagDeleteMode || calendarMode !== "month") {
        return;
      }

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

    function handlePointerUp(event: PointerEvent) {
      const pendingDrag = pendingTagDragRef.current;
      if (!pendingDrag) {
        return;
      }

      if (pendingDrag.active && calendarMode === "month") {
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
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [calendarMode, tagDeleteMode, tagAssignments, tags]);

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
    const newEvent = createTask({
      date: selectedDateKey,
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

    if (completed && task.recurrence !== "none") {
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

  function openEventInCalendar(event: TaskEvent) {
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
              {task.date} · {formatTaskTime(task)}
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
        ) : (
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
        )}
      </section>
    </main>
  );
}

export default App;

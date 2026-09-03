export function createScheduleState(mode = "today") {
  return { mode };
}

export function visiblePanels(state) {
  return {
    today: state.mode === "today" || state.mode === "both",
    week: state.mode === "week" || state.mode === "both"
  };
}

export function serializeScheduleState(state) {
  return JSON.stringify({ mode: state.mode });
}

export function hydrateScheduleState(raw) {
  if (!raw) return createScheduleState();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.mode === "today" || parsed.mode === "week") {
      return createScheduleState(parsed.mode);
    }

    if (typeof parsed.todayVisible === "boolean" || typeof parsed.weekVisible === "boolean") {
      return { mode: "both" };
    }
  } catch {}
  return createScheduleState();
}

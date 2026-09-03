export function createScheduleState(mode = "today") {
  return { mode };
}

export function visiblePanels(state) {
  return {
    today: state.mode === "today",
    week: state.mode === "week"
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
  } catch {}
  return createScheduleState();
}

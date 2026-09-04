export const PROJECT_LENGTH = 16;
export const MIN_CLIP_DURATION = 0.125;
export const HISTORY_LIMIT = 80;
export const DEFAULT_TRACKS = [
  { id: "drums", name: "Drums", color: "coral", instrument: "drums", gain: 0.9, muted: false },
  { id: "bass", name: "Bass", color: "amber", instrument: "bass", gain: 0.82, muted: false },
  { id: "texture", name: "Texture", color: "mint", instrument: "texture", gain: 0.65, muted: false },
  { id: "voice", name: "Voice", color: "violet", instrument: "synth", gain: 0.72, muted: false }
];

let nextClipId = 1;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const projectDuration = (project) => Math.max(MIN_CLIP_DURATION, finite(project?.duration ?? project?.length, PROJECT_LENGTH));

export function snapTime(value, step = 0.5) {
  const safeStep = Math.max(0.001, finite(step, 0.5));
  return Math.round(Math.max(0, finite(value, 0)) / safeStep) * safeStep;
}

function normalizeDuration(duration, maxDuration, snap = 0.5) {
  const minimum = Math.min(Math.max(MIN_CLIP_DURATION, Math.min(finite(snap, 0.5), 0.5)), maxDuration);
  const snapped = Math.max(minimum, snapTime(duration, snap));
  return clamp(snapped, minimum, maxDuration);
}

function uniqueClipId(project) {
  const used = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  let id;
  do id = `clip-${nextClipId++}`; while (used.has(id));
  return id;
}

export function syncIdAllocator(project) {
  let max = 0;
  const used = new Set();
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      used.add(clip.id);
      const match = /^clip-(\d+)$/.exec(String(clip.id));
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  nextClipId = Math.max(max + 1, 1);
  while (used.has(`clip-${nextClipId}`)) nextClipId += 1;
  return nextClipId;
}

export function createProject(options = {}) {
  nextClipId = 1;
  const duration = Math.max(4, finite(options.duration ?? options.length, PROJECT_LENGTH));
  const tracks = (options.tracks || DEFAULT_TRACKS).map((track, index) => ({
    id: String(track.id || `track-${index + 1}`),
    name: String(track.name || `Track ${index + 1}`),
    color: String(track.color || ["coral", "amber", "mint", "violet"][index % 4]),
    instrument: String(track.instrument || "synth"),
    gain: clamp(finite(track.gain, 0.8), 0, 1),
    muted: Boolean(track.muted),
    clips: Array.isArray(track.clips) ? track.clips.map((clip) => ({ ...clip })) : []
  }));
  const project = {
    version: 1,
    name: String(options.name || "Untitled arrangement"),
    duration,
    length: duration,
    bpm: clamp(finite(options.bpm, 112), 40, 240),
    snap: Math.max(0.0625, finite(options.snap, 0.5)),
    zoom: clamp(finite(options.zoom, 88), 36, 240),
    playhead: clamp(finite(options.playhead, 0), 0, duration),
    playing: false,
    loop: {
      enabled: Boolean(options.loop?.enabled),
      start: clamp(finite(options.loop?.start, 4), 0, duration - MIN_CLIP_DURATION),
      end: clamp(finite(options.loop?.end, 8), MIN_CLIP_DURATION, duration)
    },
    tracks
  };
  if (project.loop.end <= project.loop.start) {
    project.loop.start = 0;
    project.loop.end = Math.min(duration, 4);
  }
  syncIdAllocator(project);
  return project;
}

export function findClip(project, clipId) {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    const clipIndex = track.clips.findIndex((candidate) => candidate.id === clipId);
    if (clipIndex !== -1) return { track, trackIndex, clip: track.clips[clipIndex], clipIndex };
  }
  return null;
}

export function addClip(project, trackId, start = 0, duration = 2, label = "New clip", metadata = {}) {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track: ${trackId}`);
  const length = projectDuration(project);
  const minimum = Math.min(Math.max(MIN_CLIP_DURATION, Math.min(project.snap || 0.5, 0.5)), length);
  const snappedStart = snapTime(start, project.snap);
  const safeStart = clamp(snappedStart, 0, Math.max(0, length - minimum));
  const safeDuration = normalizeDuration(duration, length - safeStart, project.snap);
  const clip = {
    id: uniqueClipId(project),
    label: String(label || "Clip"),
    start: safeStart,
    duration: safeDuration,
    kind: String(metadata.kind || track.instrument || "clip"),
    gain: clamp(finite(metadata.gain, 0.9), 0, 1),
    notes: String(metadata.notes || "")
  };
  track.clips.push(clip);
  return clip;
}

export function deleteClip(project, clipId) {
  const found = findClip(project, clipId);
  if (!found) return null;
  return found.track.clips.splice(found.clipIndex, 1)[0] || null;
}

export function moveClip(project, clipId, nextStart, nextTrackId = null) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const targetTrack = nextTrackId ? project.tracks.find((track) => track.id === nextTrackId) : found.track;
  if (!targetTrack) throw new Error(`Unknown track: ${nextTrackId}`);
  const length = projectDuration(project);
  found.clip.start = clamp(snapTime(nextStart, project.snap), 0, Math.max(0, length - found.clip.duration));
  if (targetTrack !== found.track) {
    found.track.clips.splice(found.clipIndex, 1);
    targetTrack.clips.push(found.clip);
  }
  return found.clip;
}

export function resizeClip(project, clipId, nextDuration) {
  const found = findClip(project, clipId);
  if (!found) return null;
  found.clip.duration = normalizeDuration(nextDuration, projectDuration(project) - found.clip.start, project.snap);
  return found.clip;
}

export function resizeClipLeft(project, clipId, nextStart) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const oldEnd = found.clip.start + found.clip.duration;
  const minimum = Math.min(Math.max(MIN_CLIP_DURATION, Math.min(project.snap || 0.5, 0.5)), oldEnd);
  const start = clamp(snapTime(nextStart, project.snap), 0, oldEnd - minimum);
  found.clip.start = start;
  found.clip.duration = oldEnd - start;
  return found.clip;
}

export function duplicateClip(project, clipId, offset = null) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const delta = offset == null ? Math.max(project.snap, 0.5) : finite(offset, project.snap);
  let start = found.clip.start + delta;
  if (start + found.clip.duration > projectDuration(project)) start = Math.max(0, found.clip.start - delta);
  const copy = addClip(project, found.track.id, start, found.clip.duration, `${found.clip.label} copy`, {
    kind: found.clip.kind,
    gain: found.clip.gain,
    notes: found.clip.notes
  });
  return copy;
}

export function renameClip(project, clipId, label) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const next = String(label ?? "").trim();
  found.clip.label = next || "Untitled clip";
  return found.clip;
}

export function setLoop(project, start, end, enabled = project.loop?.enabled ?? false) {
  const length = projectDuration(project);
  const safeStart = clamp(snapTime(start, project.snap), 0, length - MIN_CLIP_DURATION);
  const safeEnd = clamp(snapTime(end, project.snap), MIN_CLIP_DURATION, length);
  if (safeEnd <= safeStart) throw new Error("Loop end must be after loop start");
  project.loop = { enabled: Boolean(enabled), start: safeStart, end: safeEnd };
  return project.loop;
}

export function timeToX(time, pixelsPerSecond) {
  return Math.max(0, finite(time, 0)) * Math.max(1, finite(pixelsPerSecond, 1));
}

export function xToTime(x, pixelsPerSecond) {
  return Math.max(0, finite(x, 0)) / Math.max(1, finite(pixelsPerSecond, 1));
}

export function viewportXToTime(clientX, viewportLeft, scrollLeft, pixelsPerSecond) {
  return xToTime(finite(clientX) - finite(viewportLeft) + Math.max(0, finite(scrollLeft)), pixelsPerSecond);
}

export function timeToViewportX(time, viewportLeft, scrollLeft, pixelsPerSecond) {
  return finite(viewportLeft) + timeToX(time, pixelsPerSecond) - Math.max(0, finite(scrollLeft));
}

export function zoomScrollForAnchor({ anchorClientX, viewportLeft, scrollLeft, oldZoom, newZoom, maxScroll = Infinity }) {
  const anchorOffset = finite(anchorClientX) - finite(viewportLeft);
  const anchorTime = viewportXToTime(anchorClientX, viewportLeft, scrollLeft, oldZoom);
  const nextScroll = timeToX(anchorTime, newZoom) - anchorOffset;
  return clamp(nextScroll, 0, Number.isFinite(maxScroll) ? Math.max(0, maxScroll) : Math.max(0, nextScroll));
}

export function advancePlayhead(position, delta, duration, loop = null) {
  const length = Math.max(MIN_CLIP_DURATION, finite(duration, PROJECT_LENGTH));
  const dt = Math.max(0, finite(delta, 0));
  let next = clamp(finite(position, 0), 0, length) + dt;
  if (loop?.enabled && loop.end > loop.start) {
    const start = clamp(finite(loop.start, 0), 0, length);
    const end = clamp(finite(loop.end, length), start + MIN_CLIP_DURATION, length);
    const span = end - start;
    if (next >= end) {
      const distance = next - start;
      next = start + ((distance % span) + span) % span;
    }
    return { position: next, ended: false };
  }
  if (next >= length) return { position: length, ended: true };
  return { position: next, ended: false };
}

export function cloneProject(project) {
  return typeof structuredClone === "function" ? structuredClone(project) : JSON.parse(JSON.stringify(project));
}

export function snapshotProject(project) {
  const copy = cloneProject(project);
  copy.playing = false;
  return copy;
}

export function validateProjectSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Project must be an object");
  const duration = finite(raw.duration ?? raw.length, NaN);
  if (!Number.isFinite(duration) || duration < 1 || duration > 60 * 60) throw new Error("Invalid project duration");
  if (!Array.isArray(raw.tracks) || raw.tracks.length < 1 || raw.tracks.length > 64) throw new Error("Project needs 1–64 tracks");
  const trackIds = new Set();
  const clipIds = new Set();
  for (const track of raw.tracks) {
    if (!track || typeof track !== "object" || !String(track.id || "").trim()) throw new Error("Invalid track");
    if (trackIds.has(track.id)) throw new Error(`Duplicate track id: ${track.id}`);
    trackIds.add(track.id);
    if (!Array.isArray(track.clips)) throw new Error(`Invalid clips for ${track.id}`);
    for (const clip of track.clips) {
      if (!clip || typeof clip !== "object" || !String(clip.id || "").trim()) throw new Error("Invalid clip");
      if (clipIds.has(clip.id)) throw new Error(`Duplicate clip id: ${clip.id}`);
      clipIds.add(clip.id);
      const start = finite(clip.start, NaN);
      const clipDuration = finite(clip.duration, NaN);
      if (!Number.isFinite(start) || !Number.isFinite(clipDuration) || start < 0 || clipDuration < MIN_CLIP_DURATION || start + clipDuration > duration + 1e-9) {
        throw new Error(`Clip ${clip.id} is outside project bounds`);
      }
    }
  }
  if (raw.loop) {
    const start = finite(raw.loop.start, NaN);
    const end = finite(raw.loop.end, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end <= start) throw new Error("Invalid loop region");
  }
  return true;
}

export function loadProjectSnapshot(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : cloneProject(input);
  validateProjectSnapshot(raw);
  const project = createProject({
    ...raw,
    duration: raw.duration ?? raw.length,
    tracks: raw.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        id: String(clip.id),
        label: String(clip.label || "Clip"),
        start: finite(clip.start),
        duration: finite(clip.duration),
        kind: String(clip.kind || track.instrument || "clip"),
        gain: clamp(finite(clip.gain, 0.9), 0, 1),
        notes: String(clip.notes || "")
      }))
    }))
  });
  project.playing = false;
  project.playhead = clamp(finite(raw.playhead, 0), 0, project.duration);
  syncIdAllocator(project);
  return project;
}

export class History {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = Math.max(1, Math.floor(finite(limit, HISTORY_LIMIT)));
    this.undoStack = [];
    this.redoStack = [];
  }

  push(label, before, after) {
    const beforeSnapshot = snapshotProject(before);
    const afterSnapshot = snapshotProject(after);
    if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) return false;
    this.undoStack.push({ label: String(label || "Edit"), before: beforeSnapshot, after: afterSnapshot });
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack.length = 0;
    return true;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { project: loadProjectSnapshot(entry.before), label: entry.label };
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { project: loadProjectSnapshot(entry.after), label: entry.label };
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

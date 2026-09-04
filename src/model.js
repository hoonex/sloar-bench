export const PROJECT_LENGTH = 16;
export const MIN_CLIP_DURATION = 0.125;
export const DEFAULT_TRACKS = [
  { id: "drums", name: "Drums", color: "#e6a84a" },
  { id: "bass", name: "Bass", color: "#70c49b" },
  { id: "texture", name: "Texture", color: "#7d9de6" },
  { id: "voice", name: "Voice", color: "#d58cc8" }
];
export const HISTORY_LIMIT = 120;

let nextClipId = 1;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function snapTime(value, step = 0.5) {
  const safeStep = Math.max(0.001, finiteNumber(step, 0.5));
  const safeValue = Math.max(0, finiteNumber(value, 0));
  return Math.round((safeValue + Number.EPSILON) / safeStep) * safeStep;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

export function createProject(options = {}) {
  nextClipId = 1;
  const length = Math.max(MIN_CLIP_DURATION, finiteNumber(options.length, PROJECT_LENGTH));
  const tracks = (options.tracks ?? DEFAULT_TRACKS).map((track, index) => ({
    id: String(track.id ?? `track-${index + 1}`),
    name: String(track.name ?? `Track ${index + 1}`),
    color: String(track.color ?? DEFAULT_TRACKS[index % DEFAULT_TRACKS.length]?.color ?? "#b9b9b9"),
    muted: Boolean(track.muted),
    clips: []
  }));
  return {
    version: 2,
    name: String(options.name ?? "Untitled Session"),
    length,
    bpm: Math.max(20, Math.min(320, finiteNumber(options.bpm, 120))),
    snap: Math.max(0.001, finiteNumber(options.snap, 0.5)),
    loop: {
      enabled: Boolean(options.loop?.enabled),
      start: clamp(options.loop?.start ?? 4, 0, Math.max(0, length - MIN_CLIP_DURATION)),
      end: clamp(options.loop?.end ?? Math.min(12, length), MIN_CLIP_DURATION, length)
    },
    tracks
  };
}

export function findClip(project, clipId) {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    const clipIndex = track.clips.findIndex((candidate) => candidate.id === clipId);
    if (clipIndex >= 0) return { clip: track.clips[clipIndex], track, trackIndex, clipIndex };
  }
  return null;
}

function allocateClipId() {
  return `clip-${nextClipId++}`;
}

function effectiveMinimumClipDuration(project) {
  return Math.min(project.length, Math.max(MIN_CLIP_DURATION, finiteNumber(project.snap, MIN_CLIP_DURATION)));
}

function normalizeClipBounds(project, start, duration) {
  const minimum = effectiveMinimumClipDuration(project);
  const snappedDuration = Math.max(minimum, snapTime(duration, project.snap));
  const maxStart = Math.max(0, project.length - minimum);
  const safeStart = clamp(snapTime(start, project.snap), 0, maxStart);
  const safeDuration = clamp(snappedDuration, minimum, Math.max(minimum, project.length - safeStart));
  return { start: safeStart, duration: safeDuration };
}

export function addClip(project, trackId, start = 0, duration = 2, label = "New clip", metadata = {}) {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track: ${trackId}`);
  const bounds = normalizeClipBounds(project, start, duration);
  const clip = {
    id: allocateClipId(),
    label: String(label || "Clip"),
    start: bounds.start,
    duration: bounds.duration,
    gain: clamp(metadata.gain ?? 1, 0, 2),
    muted: Boolean(metadata.muted),
    color: metadata.color ? String(metadata.color) : null
  };
  track.clips.push(clip);
  return clip;
}

export function deleteClip(project, clipId) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const [removed] = found.track.clips.splice(found.clipIndex, 1);
  return removed;
}

export function renameClip(project, clipId, label) {
  const found = findClip(project, clipId);
  if (!found) return null;
  found.clip.label = String(label || "Clip").slice(0, 80);
  return found.clip;
}

export function moveClip(project, clipId, nextStart, nextTrackId = null) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const targetTrack = nextTrackId == null
    ? found.track
    : project.tracks.find((candidate) => candidate.id === nextTrackId);
  if (!targetTrack) throw new Error(`Unknown track: ${nextTrackId}`);

  const snapped = snapTime(nextStart, project.snap);
  found.clip.start = clamp(snapped, 0, Math.max(0, project.length - found.clip.duration));
  if (targetTrack !== found.track) {
    found.track.clips.splice(found.clipIndex, 1);
    targetTrack.clips.push(found.clip);
  }
  return found.clip;
}

// Legacy public operation: right-edge resize by duration.
export function resizeClip(project, clipId, nextDuration) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const minimum = effectiveMinimumClipDuration(project);
  const snapped = Math.max(minimum, snapTime(nextDuration, project.snap));
  found.clip.duration = clamp(snapped, minimum, Math.max(minimum, project.length - found.clip.start));
  return found.clip;
}

export function resizeClipRight(project, clipId, nextEnd) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const minimum = effectiveMinimumClipDuration(project);
  const snappedEnd = snapTime(nextEnd, project.snap);
  const end = clamp(snappedEnd, found.clip.start + minimum, project.length);
  found.clip.duration = end - found.clip.start;
  return found.clip;
}

export function resizeClipLeft(project, clipId, nextStart) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const minimum = effectiveMinimumClipDuration(project);
  const end = found.clip.start + found.clip.duration;
  const start = clamp(snapTime(nextStart, project.snap), 0, end - minimum);
  found.clip.start = start;
  found.clip.duration = end - start;
  return found.clip;
}

export function duplicateClip(project, clipId, offset = null) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const delta = offset == null ? project.snap : finiteNumber(offset, project.snap);
  const desired = found.clip.start + delta;
  const start = desired + found.clip.duration <= project.length
    ? desired
    : Math.max(0, found.clip.start - delta);
  return addClip(project, found.track.id, start, found.clip.duration, `${found.clip.label} copy`, {
    gain: found.clip.gain,
    muted: found.clip.muted,
    color: found.clip.color
  });
}

export function setLoop(project, start, end, enabled = project.loop.enabled) {
  const minimum = Math.min(MIN_CLIP_DURATION, project.length);
  const safeStart = clamp(snapTime(start, project.snap), 0, Math.max(0, project.length - minimum));
  const safeEnd = clamp(snapTime(end, project.snap), minimum, project.length);
  if (safeEnd <= safeStart) throw new Error("Loop end must be after loop start");
  project.loop = { enabled: Boolean(enabled), start: safeStart, end: safeEnd };
  return project.loop;
}

export function timeToX(time, pixelsPerSecond) {
  return Math.max(0, finiteNumber(time, 0)) * Math.max(1, finiteNumber(pixelsPerSecond, 1));
}

export function xToTime(x, pixelsPerSecond) {
  return Math.max(0, finiteNumber(x, 0)) / Math.max(1, finiteNumber(pixelsPerSecond, 1));
}

export function timeToViewportX(time, scrollLeft, pixelsPerSecond) {
  return timeToX(time, pixelsPerSecond) - Math.max(0, finiteNumber(scrollLeft, 0));
}

export function viewportXToTime(viewportX, scrollLeft, pixelsPerSecond) {
  return xToTime(Math.max(0, finiteNumber(viewportX, 0) + Math.max(0, finiteNumber(scrollLeft, 0))), pixelsPerSecond);
}

export function zoomScrollForAnchor(anchorViewportX, oldScrollLeft, oldPixelsPerSecond, newPixelsPerSecond) {
  const anchorTime = viewportXToTime(anchorViewportX, oldScrollLeft, oldPixelsPerSecond);
  return Math.max(0, timeToX(anchorTime, newPixelsPerSecond) - Math.max(0, finiteNumber(anchorViewportX, 0)));
}

export function cloneProject(project) {
  return typeof structuredClone === "function" ? structuredClone(project) : JSON.parse(JSON.stringify(project));
}

export function snapshotProject(project) {
  return cloneProject(project);
}

export function serializeProject(project) {
  return JSON.stringify(snapshotProject(project), null, 2);
}

function validateTrackIds(tracks) {
  const ids = new Set();
  for (const track of tracks) {
    if (!track || typeof track !== "object") throw new Error("Invalid track");
    const id = String(track.id ?? "").trim();
    if (!id || ids.has(id)) throw new Error("Track IDs must be unique and non-empty");
    ids.add(id);
  }
}

function syncClipAllocator(project) {
  let maxNumericId = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const match = /^clip-(\d+)$/.exec(clip.id);
      if (match) maxNumericId = Math.max(maxNumericId, Number(match[1]));
    }
  }
  nextClipId = Math.max(nextClipId, maxNumericId + 1);
}

export function normalizeProjectSnapshot(input) {
  const source = typeof input === "string" ? JSON.parse(input) : cloneProject(input);
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Project snapshot must be an object");
  const length = finiteNumber(source.length, NaN);
  if (!Number.isFinite(length) || length < MIN_CLIP_DURATION || length > 60 * 60 * 12) throw new Error("Invalid project length");
  if (!Array.isArray(source.tracks) || source.tracks.length < 1 || source.tracks.length > 64) throw new Error("Invalid tracks");
  validateTrackIds(source.tracks);

  const project = createProject({
    length,
    name: source.name,
    bpm: source.bpm,
    snap: source.snap,
    loop: source.loop,
    tracks: source.tracks
  });
  const clipIds = new Set();
  for (let trackIndex = 0; trackIndex < source.tracks.length; trackIndex += 1) {
    const sourceTrack = source.tracks[trackIndex];
    if (!Array.isArray(sourceTrack.clips)) throw new Error("Track clips must be an array");
    const targetTrack = project.tracks[trackIndex];
    for (const rawClip of sourceTrack.clips) {
      if (!rawClip || typeof rawClip !== "object") throw new Error("Invalid clip");
      const id = String(rawClip.id ?? "").trim();
      if (!id || clipIds.has(id)) throw new Error("Clip IDs must be unique and non-empty");
      clipIds.add(id);
      const start = finiteNumber(rawClip.start, NaN);
      const duration = finiteNumber(rawClip.duration, NaN);
      if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < MIN_CLIP_DURATION || start + duration > length + 1e-9) {
        throw new Error(`Clip ${id} is outside project bounds`);
      }
      targetTrack.clips.push({
        id,
        label: String(rawClip.label || "Clip").slice(0, 80),
        start,
        duration,
        gain: clamp(rawClip.gain ?? 1, 0, 2),
        muted: Boolean(rawClip.muted),
        color: rawClip.color ? String(rawClip.color) : null
      });
    }
  }

  const loopStart = finiteNumber(source.loop?.start, 0);
  const loopEnd = finiteNumber(source.loop?.end, length);
  if (loopStart < 0 || loopEnd > length || loopStart >= loopEnd) throw new Error("Invalid loop range");
  project.loop = { enabled: Boolean(source.loop?.enabled), start: loopStart, end: loopEnd };
  project.version = 2;
  syncClipAllocator(project);
  return project;
}

export function createHistory(initialProject, limit = HISTORY_LIMIT) {
  const safeLimit = Math.max(2, Math.floor(finiteNumber(limit, HISTORY_LIMIT)));
  return {
    past: [],
    present: snapshotProject(initialProject),
    future: [],
    limit: safeLimit
  };
}

export function historyCommit(history, project) {
  const next = snapshotProject(project);
  const previous = snapshotProject(history.present);
  history.past.push(previous);
  if (history.past.length > history.limit) history.past.splice(0, history.past.length - history.limit);
  history.present = next;
  history.future.length = 0;
  return snapshotProject(history.present);
}

export function historyUndo(history) {
  if (!history.past.length) return null;
  history.future.unshift(snapshotProject(history.present));
  history.present = history.past.pop();
  syncClipAllocator(history.present);
  return snapshotProject(history.present);
}

export function historyRedo(history) {
  if (!history.future.length) return null;
  history.past.push(snapshotProject(history.present));
  if (history.past.length > history.limit) history.past.splice(0, history.past.length - history.limit);
  history.present = history.future.shift();
  syncClipAllocator(history.present);
  return snapshotProject(history.present);
}

export function replaceHistoryPresent(history, project) {
  history.present = snapshotProject(project);
  history.past.length = 0;
  history.future.length = 0;
  syncClipAllocator(history.present);
  return snapshotProject(history.present);
}

export function advancePlayhead(project, playhead, deltaSeconds) {
  const delta = Math.max(0, finiteNumber(deltaSeconds, 0));
  const start = clamp(playhead, 0, project.length);
  if (!delta) return { playhead: start, ended: false };

  if (project.loop?.enabled) {
    const loopStart = clamp(project.loop.start, 0, project.length);
    const loopEnd = clamp(project.loop.end, loopStart + MIN_CLIP_DURATION, project.length);
    const loopLength = loopEnd - loopStart;
    if (start < loopEnd && start + delta >= loopEnd) {
      const distanceToLoop = Math.max(0, loopEnd - start);
      const remainder = Math.max(0, delta - distanceToLoop);
      return { playhead: loopStart + (remainder % loopLength), ended: false };
    }
    if (start >= loopStart && start < loopEnd) {
      return { playhead: loopStart + ((start - loopStart + delta) % loopLength), ended: false };
    }
  }

  const next = start + delta;
  if (next >= project.length) return { playhead: project.length, ended: true };
  return { playhead: next, ended: false };
}

export function assertProjectInvariants(project) {
  if (!project || !Array.isArray(project.tracks)) throw new Error("Project must contain tracks");
  const trackIds = new Set();
  const clipIds = new Set();
  for (const track of project.tracks) {
    if (trackIds.has(track.id)) throw new Error(`Duplicate track ID: ${track.id}`);
    trackIds.add(track.id);
    for (const clip of track.clips) {
      if (clipIds.has(clip.id)) throw new Error(`Duplicate clip ID: ${clip.id}`);
      clipIds.add(clip.id);
      if (clip.start < -1e-9 || clip.duration < MIN_CLIP_DURATION - 1e-9 || clip.start + clip.duration > project.length + 1e-9) {
        throw new Error(`Clip out of bounds: ${clip.id}`);
      }
    }
  }
  if (project.loop.start < 0 || project.loop.end > project.length || project.loop.start >= project.loop.end) throw new Error("Loop invariant violated");
  return true;
}

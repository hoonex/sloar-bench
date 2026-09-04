export const PROJECT_LENGTH = 16;
export const DEFAULT_TRACKS = [
  { id: "drums", name: "Drums" },
  { id: "bass", name: "Bass" },
  { id: "texture", name: "Texture" },
  { id: "voice", name: "Voice" }
];

let nextClipId = 1;

export function snapTime(value, step = 0.5) {
  const safeStep = Math.max(0.001, Number(step) || 0.5);
  return Math.round(Math.max(0, Number(value) || 0) / safeStep) * safeStep;
}

export function createProject() {
  nextClipId = 1;
  return {
    length: PROJECT_LENGTH,
    zoom: 80,
    snap: 0.5,
    playhead: 0,
    playing: false,
    tracks: DEFAULT_TRACKS.map((track) => ({ ...track, clips: [] }))
  };
}

export function addClip(project, trackId, start = 0, duration = 2, label = "New clip") {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track: ${trackId}`);
  const safeStart = Math.min(project.length, snapTime(start, project.snap));
  const safeDuration = Math.max(project.snap, snapTime(duration, project.snap));
  const clip = {
    id: `clip-${nextClipId++}`,
    label: String(label || "Clip"),
    start: safeStart,
    duration: Math.min(safeDuration, Math.max(project.snap, project.length - safeStart))
  };
  track.clips.push(clip);
  return clip;
}

export function moveClip(project, clipId, nextStart) {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;
    const snapped = snapTime(nextStart, project.snap);
    clip.start = Math.max(0, Math.min(project.length - clip.duration, snapped));
    return clip;
  }
  return null;
}

export function resizeClip(project, clipId, nextDuration) {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;
    const snapped = Math.max(project.snap, snapTime(nextDuration, project.snap));
    clip.duration = Math.min(snapped, project.length - clip.start);
    return clip;
  }
  return null;
}

export function timeToX(time, pixelsPerSecond) {
  return Math.max(0, Number(time) || 0) * Math.max(1, Number(pixelsPerSecond) || 1);
}

export function xToTime(x, pixelsPerSecond) {
  return Math.max(0, Number(x) || 0) / Math.max(1, Number(pixelsPerSecond) || 1);
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

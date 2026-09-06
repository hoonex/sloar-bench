export const PROPOSALS = {
  a: {
    title: "Guard retries at the request boundary",
    meta: "2 files · 18 lines",
    reasoning: "Keeps retry accounting beside the existing request loop, reuses the current metrics path, and adds no shared abstraction for a single call site.",
    changes: [
      { file: "src/http/request.ts", label: "Cap retries with a per-request budget", code: "+ const retriesLeft = Math.max(0, budget - attempt);" },
      { file: "src/http/metrics.ts", label: "Preserve the existing retry metric", code: "+ retryCounter.add(1, { reason: error.code });" },
      { file: "src/http/request.ts", label: "Rename attemptIndex to retryIndex", code: "- attemptIndex  + retryIndex" }
    ]
  },
  b: {
    title: "Move retry decisions into a policy object",
    meta: "4 files · 42 lines",
    reasoning: "Introduces a small policy boundary so retry limits and backoff decisions live together. More structure now, but easier to extend if additional retry rules are expected.",
    changes: [
      { file: "src/http/retry-policy.ts", label: "Add a retry budget policy", code: "+ export function canRetry(attempt, budget) { … }" },
      { file: "src/http/request.ts", label: "Delegate retry decisions to the policy", code: "+ if (!canRetry(attempt, budget)) throw error;" },
      { file: "test/retry-policy.test.ts", label: "Cover budget exhaustion", code: "+ expect(canRetry(3, 3)).toBe(false);" }
    ]
  },
  c: {
    title: "Extract a bounded retry helper",
    meta: "3 files · 31 lines",
    reasoning: "Wraps the current loop in a focused helper and leaves metrics at the call site. It reduces request.ts complexity without introducing a broader policy abstraction.",
    changes: [
      { file: "src/http/with-retry.ts", label: "Extract the retry loop", code: "+ export async function withRetry(task, budget) { … }" },
      { file: "src/http/request.ts", label: "Call the bounded helper", code: "+ return withRetry(send, retryBudget);" },
      { file: "test/request.test.ts", label: "Verify metrics survive retries", code: "+ assert.equal(metrics.retryCount, 2);" }
    ]
  }
};

const DEFAULT_ACCEPTED = {
  a: [true, true, false],
  b: [true, false, true],
  c: [true, true, true]
};

export function createRelayState(activeAgent = "a", accepted = DEFAULT_ACCEPTED) {
  const safeAgent = PROPOSALS[activeAgent] ? activeAgent : "a";
  return {
    activeAgent: safeAgent,
    accepted: Object.fromEntries(
      Object.keys(PROPOSALS).map((key) => [key, PROPOSALS[key].changes.map((_, index) => Boolean(accepted?.[key]?.[index]))])
    )
  };
}

export function selectAgent(state, agent) {
  if (!PROPOSALS[agent]) return state;
  return { ...state, activeAgent: agent };
}

export function toggleChange(state, index) {
  const key = state.activeAgent;
  if (!Number.isInteger(index) || index < 0 || index >= PROPOSALS[key].changes.length) return state;
  const next = [...state.accepted[key]];
  next[index] = !next[index];
  return { ...state, accepted: { ...state.accepted, [key]: next } };
}

export function selectedChangeCount(state) {
  return state.accepted[state.activeAgent].filter(Boolean).length;
}

export function serializeRelayState(state) {
  return JSON.stringify({ activeAgent: state.activeAgent, accepted: state.accepted });
}

export function hydrateRelayState(raw) {
  if (!raw) return createRelayState();
  try {
    const parsed = JSON.parse(raw);
    return createRelayState(parsed.activeAgent, parsed.accepted);
  } catch {
    return createRelayState();
  }
}

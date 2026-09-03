export class FakeRunner {
  constructor() {
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
    this.activeByGroup = new Map();
    this.maxByGroup = new Map();
    this.gates = [];
  }

  gate(promise) {
    this.gates.push(promise);
  }

  async run(task, context) {
    this.calls.push({
      id: task.id,
      tenantId: task.tenantId,
      group: task.group,
      input: task.input,
      priority: task.priority,
      attempt: context.attempt,
      executionId: context.executionId
    });

    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const group = String(task.group ?? "default");
    const groupActive = (this.activeByGroup.get(group) ?? 0) + 1;
    this.activeByGroup.set(group, groupActive);
    this.maxByGroup.set(group, Math.max(this.maxByGroup.get(group) ?? 0, groupActive));

    try {
      const gate = this.gates.shift();
      if (gate) await gate;
      if (context.signal.aborted) throw new Error("aborted");
      return { id: task.id, tenantId: task.tenantId, attempt: context.attempt };
    } finally {
      this.active -= 1;
      this.activeByGroup.set(group, (this.activeByGroup.get(group) ?? 1) - 1);
    }
  }
}

function stableEncode(value, seen = new Set()) {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return `string:${JSON.stringify(value)}`;
    case "number":
      if (Number.isNaN(value)) return "number:NaN";
      if (value === Infinity) return "number:Infinity";
      if (value === -Infinity) return "number:-Infinity";
      return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
    case "boolean":
      return `boolean:${value}`;
    case "undefined":
      return "undefined";
    case "bigint":
      return `bigint:${value.toString()}`;
    case "object": {
      if (seen.has(value)) {
        throw new TypeError("task input must not contain circular references");
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `array:[${value.map((item) => stableEncode(item, seen)).join(",")}]`;
        }

        const entries = Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stableEncode(value[key], seen)}`);
        return `object:{${entries.join(",")}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new TypeError(`unsupported task identity value: ${typeof value}`);
  }
}

export function taskKey(task) {
  const input = task.input === undefined ? {} : task.input;
  return stableEncode([task.tenantId, task.id, input]);
}

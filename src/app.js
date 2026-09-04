import * as model from "./model.js";

// Load the editor as ordered classic-script segments so one shared global lexical
// environment owns the live workspace state while the model remains an ES module.
Object.assign(globalThis, model);

for (const source of ["./editor-core.js", "./editor-actions.js", "./editor-wiring.js"]) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(source, import.meta.url).href;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => reject(new Error(`Unable to load Tapegrid segment: ${source}`));
    document.head.append(script);
  });
}

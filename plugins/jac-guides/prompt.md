The installed `jac` binary ships official guides (`jac` tool, action "guide"). Read the right one before writing
unfamiliar Jac, and whenever a compiler error points to one (`→ run 'jac guide X'`). For long guides, pass
args ["--sections"] first, then ["--section", "<name>"] to read just what you need.

| Task | Guide |
|---|---|
| Syntax or type error | the guide the diagnostic names, else jac-core-cheatsheet or jac-types |
| Fields, defaults, postinit | jac-has-fields |
| Splitting declarations and impl files | jac-impl-files |
| Graph shape, nodes and edges | jac-node-edge-patterns |
| Walker traversal, reports, early exit | jac-walker-patterns |
| Tests | jac-testing |
| LLM-backed functions (`by llm`) | jac-by-llm |
| Server endpoints, persistence | jac-sv-endpoints, jac-sv-persistence |
| UI components (client code) | jac-cl-components |
| Python libraries | jac-python-interop |
| Debugging a running app | jac-debugging |

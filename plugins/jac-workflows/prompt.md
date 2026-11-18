Quality bar for Jac changes:
- Before finishing, `jac check` passes on every changed file and `jac test` passes where tests exist.
- New behaviour gets a `test` block. Walkers are tested with `root spawn W()` and `.reports`, and each test builds
  its own graph (tests run in parallel and don't share state).
- Prefer the idiomatic form: typed edges over id fields, `obj` over `class` for data, project-root imports over
  `..` relative ones, `with entry:__main__` for scripts.

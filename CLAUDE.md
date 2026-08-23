# Development Instructions

- At the end of every code change, build a Firefox `.xpi` package for the extension.
- Always zip the working tree in place. Never stage a copy of the sources in a temp directory and zip that — the package must come from exactly what is on disk.
- Always write the finished `.xpi` to the repository's main checkout root, never inside a git worktree. When working from a worktree, zip that worktree's sources but send the output to the main checkout, so there is one stable path to load the package from.

# Kiro Resources

A template repository of reusable [Kiro](https://kiro.dev) resources — hooks, agents, steering files, skills, and tools — ready to drop into any workspace.

## What's Inside

| Category | Path | Description |
|----------|------|-------------|
| Hooks | `/hooks/` | Agent hooks that fire on IDE events (session start, file save, etc.) |

> More categories (agents, steering, skills) coming soon.

## Included Hooks

### What's New Kiro?

A `SessionStart` hook that fetches the Kiro changelog and blog RSS feeds, detects entries published since the last session, and asks the agent to summarize them. Stays silent when there's nothing new.

- **Feeds:** `https://kiro.dev/changelog/feed.rss`, `https://kiro.dev/blog/feed.rss`
- **State:** Stored in `.kiro/hooks/.state/` (git-ignored)
- **Behavior:** On the very first run it shows the most recent entries as an overview; subsequent runs only show what's new.

## Usage

1. Clone or fork this repo as your workspace (or copy the `.kiro/` folder into an existing project).
2. Open the workspace in Kiro — hooks activate automatically.
3. Customize or add your own resources under `.kiro/`.

## Contributing

Feel free to open issues or PRs to add new hooks, agents, steering files, or other Kiro resources.

## License

MIT

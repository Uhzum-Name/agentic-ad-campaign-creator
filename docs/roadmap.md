# Roadmap

| # | Milestone | State |
|---|---|---|
| 1 | Architecture and technical foundation | Done |
| 2 | Main interface and workspace | Not started |
| 3 | Creative document model and design ingestion | Schema only |
| 4 | Agent orchestration and creative planning | Not started |
| 5 | Variation generation engine | Not started |
| 6 | Creative editing and manipulation | Not started |
| 7 | Animation engine | Not started |
| 8 | Intelligent resizing and adaptation | Not started |
| 9 | Rendering, export and validation | Not started |
| 10 | MCP and API platform | REST foundation only |
| 11 | Background execution and recipes | Job system only |
| 12 | End-to-end hardening | Not started |

## Sequencing change under consideration

The agent is an external MCP client rather than a server-side model (see
architecture.md). A minimal MCP server therefore has to exist by milestone 4,
not milestone 10, because planning and variation generation depend on it.
Milestone 10 then becomes "complete and harden the MCP surface".

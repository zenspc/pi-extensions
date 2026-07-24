# @zenspc/pi-codebase-memory

Token-efficient codebase intelligence for [pi](https://pi.dev). Wraps [codebase-memory-mcp](https://github.com/anthropics/codebase-memory-mcp) into 4 consolidated tools instead of 14, reducing system prompt token overhead by ~75-80%.

## Why?

The default MCP integration adds 14 tool schemas to your system prompt on every LLM call (~3,000-3,500 tokens). This extension consolidates them into 4 purpose-grouped tools (~700-900 tokens), saving you context for actual conversation.

| Approach | Tools | Tokens per turn | Savings |
|----------|-------|-----------------|---------|
| MCP (default) | 14 | ~3,000-3,500 | - |
| This extension | 4 | ~700-900 | ~75-80% |

## Tools

### `cb_search` - Code and Graph Search

Search for code entities, text patterns, and function source code.

| Mode | Description | Replaces |
|------|-------------|----------|
| `graph` | BM25 ranked search over code entities | `search_graph` |
| `code` | Grep-based text search with graph enrichment | `search_code` |
| `snippet` | Read source for a specific function/class | `get_code_snippet` |
| `semantic` | Vector cosine search bridging vocabulary | `semantic_query` |

### `cb_query` - Graph Queries and Tracing

Run Cypher queries and trace execution paths.

| Mode | Description | Replaces |
|------|-------------|----------|
| `cypher` | Raw Cypher queries against the knowledge graph | `query_graph` |
| `trace` | Follow call/data-flow/cross-service paths | `trace_path` |

### `cb_explore` - Architecture Exploration

Explore project structure and metadata.

| Mode | Description | Replaces |
|------|-------------|----------|
| `architecture` | High-level overview with clusters | `get_architecture` |
| `schema` | Graph schema (node/edge types) | `get_graph_schema` |
| `projects` | List all indexed projects | `list_projects` |
| `status` | Indexing status for a project | `index_status` |

### `cb_manage` - Index Management

Manage the codebase index.

| Mode | Description | Replaces |
|------|-------------|----------|
| `index` | (Re)index a repository | `index_repository` |
| `delete` | Remove a project from the index | `delete_project` |
| `detect_changes` | Find changes since a git ref | `detect_changes` |
| `adr` | Manage Architecture Decision Records | `manage_adr` |
| `ingest_traces` | Ingest runtime traces | `ingest_traces` |

## Installation

### 1. Install the MCP binary

```bash
codebase-memory-mcp install
```

### 2. Install the pi extension

```bash
pi install npm:@zenspc/pi-codebase-memory
```

### 3. Disable the MCP server (recommended)

To avoid duplicate tools, remove or comment out the `codebase-memory` entry in `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    // "codebase-memory": { ... }
  }
}
```

## Usage

The tools are automatically available in pi. The extension checks for the binary on startup and warns if not found.

### Examples

```
# Search for authentication-related functions
cb_search project=my-project mode=graph query=authentication

# Find all TypeScript files matching a pattern
cb_search project=my-project mode=code query="export.*function" regex=true file_pattern=*.ts

# Read a specific function's source
cb_search project=my-project mode=snippet query="src/auth/login.handleLogin"

# Trace who calls a function
cb_query project=my-project mode=trace query=handleLogin direction=inbound depth=3

# Get project architecture overview
cb_explore mode=architecture project=my-project

# List all indexed projects
cb_explore mode=projects

# Index a repository
cb_manage project=my-project mode=index repo_path=/path/to/repo index_mode=full
```

## How It Works

The extension calls the `codebase-memory-mcp` binary directly via its `cli` subcommand, bypassing MCP JSON-RPC protocol overhead. Each tool dispatches to the appropriate underlying MCP tool based on the `mode` parameter.

Results are automatically truncated to prevent context overflow, with full output saved to a temp file when truncated.

## Requirements

- `codebase-memory-mcp` binary installed and available at `~/.local/bin/codebase-memory-mcp`
- pi coding agent

## License

MIT

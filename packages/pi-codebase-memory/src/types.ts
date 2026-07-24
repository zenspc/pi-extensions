/**
 * Type definitions and schemas for the pi-codebase-memory extension.
 *
 * Consolidates 14 MCP tools into 4 grouped tools:
 *   cb_search  - search_graph, search_code, get_code_snippet, semantic_query
 *   cb_query   - query_graph, trace_path
 *   cb_explore - get_architecture, get_graph_schema, list_projects, index_status
 *   cb_manage  - index_repository, delete_project, detect_changes, manage_adr, ingest_traces
 */

import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

// ── cb_search ────────────────────────────────────────────────────────────

export const CbSearchSchema = Type.Object({
	project: Type.String({ description: "Indexed project name. Use cb_explore mode=projects to list available." }),
	mode: StringEnum(["graph", "code", "snippet", "semantic"] as const, {
		description: "graph: BM25 ranked search over code entities. code: grep-based text search enriched with graph metadata. snippet: read source for a specific function/class. semantic: vector cosine search bridging vocabulary.",
	}),
	query: Type.String({ description: "Search input. For graph/code: keywords or pattern. For snippet: qualified_name or short function name. For semantic: search terms." }),
	label: Type.Optional(Type.String({ description: "Filter by node label (Function, Class, Route, etc.). graph mode only." })),
	name_pattern: Type.Optional(Type.String({ description: "Regex for exact name matching. graph mode only." })),
	file_pattern: Type.Optional(Type.String({ description: "Glob filter on files (e.g. *.ts). For code: passed to grep --include." })),
	regex: Type.Optional(Type.Boolean({ description: "Treat query as regex. code mode only. Default: false." })),
	limit: Type.Optional(Type.Integer({ description: "Max results. Default varies by mode.", minimum: 1 })),
	offset: Type.Optional(Type.Integer({ description: "Skip first N results for pagination. graph mode only. Default: 0.", minimum: 0 })),
	mode_code: Type.Optional(StringEnum(["compact", "full", "files"] as const, {
		description: "code mode output: compact (signatures, default), full (with source), files (file list only).",
	})),
	context: Type.Optional(Type.Integer({ description: "Lines of context around matches (like grep -C). code mode compact only.", minimum: 0 })),
	include_neighbors: Type.Optional(Type.Boolean({ description: "Include connected nodes in snippet output. snippet mode only. Default: false." })),
	semantic_keywords: Type.Optional(Type.Array(Type.String(), {
		description: "Array of keyword strings for semantic search (e.g. [\"send\",\"pubsub\"]). semantic mode only. Results score well on ALL keywords.",
	})),
}, { additionalProperties: false });

export type CbSearchInput = Static<typeof CbSearchSchema>;

// ── cb_query ─────────────────────────────────────────────────────────────

export const CbQuerySchema = Type.Object({
	project: Type.String({ description: "Indexed project name." }),
	mode: StringEnum(["cypher", "trace"] as const, {
		description: "cypher: run a raw Cypher query against the knowledge graph. trace: follow call/data-flow paths from a function.",
	}),
	query: Type.String({ description: "For cypher: the Cypher query string. For trace: the function name to trace from." }),
	direction: Type.Optional(StringEnum(["inbound", "outbound", "both"] as const, {
		description: "Trace direction. trace mode only. Default: both.",
	})),
	depth: Type.Optional(Type.Integer({ description: "Max hop depth. trace mode only. Default: 3.", minimum: 1, maximum: 10 })),
	trace_mode: Type.Optional(StringEnum(["calls", "data_flow", "cross_service"] as const, {
		description: "Trace type: calls (CALLS edges), data_flow (CALLS+DATA_FLOWS with args), cross_service (through Routes). trace mode only.",
	})),
	parameter_name: Type.Optional(Type.String({ description: "Scope data_flow trace to a specific parameter. trace mode data_flow only." })),
	risk_labels: Type.Optional(Type.Boolean({ description: "Add CRITICAL/HIGH/MEDIUM/LOW risk classification. trace mode only. Default: false." })),
	include_tests: Type.Optional(Type.Boolean({ description: "Include test files in trace results. trace mode only. Default: false." })),
	max_rows: Type.Optional(Type.Integer({ description: "Row limit for Cypher results. cypher mode only. Default: unlimited (100k ceiling).", minimum: 1 })),
}, { additionalProperties: false });

export type CbQueryInput = Static<typeof CbQuerySchema>;

// ── cb_explore ───────────────────────────────────────────────────────────

export const CbExploreSchema = Type.Object({
	mode: StringEnum(["architecture", "schema", "projects", "status"] as const, {
		description: "architecture: high-level project overview with clusters. schema: graph schema (node/edge types). projects: list all indexed projects. status: indexing status for a project.",
	}),
	project: Type.Optional(Type.String({ description: "Project name. Required for architecture and status modes." })),
	aspects: Type.Optional(Type.Array(Type.String(), {
		description: "Filter architecture aspects (e.g. [\"packages\",\"services\"]). architecture mode only.",
	})),
}, { additionalProperties: false });

export type CbExploreInput = Static<typeof CbExploreSchema>;

// ── cb_manage ────────────────────────────────────────────────────────────

export const CbManageSchema = Type.Object({
	project: Type.String({ description: "Project name or repo path. Required for all modes." }),
	mode: StringEnum(["index", "delete", "detect_changes", "adr", "ingest_traces"] as const, {
		description: "index: (re)index a repository. delete: remove a project from the index. detect_changes: find code changes since a ref. adr: create/update Architecture Decision Records. ingest_traces: ingest runtime traces.",
	}),
	repo_path: Type.Optional(Type.String({ description: "Path to repository. index mode only. Defaults to project if it looks like a path." })),
	index_mode: Type.Optional(StringEnum(["full", "moderate", "fast", "cross-repo-intelligence"] as const, {
		description: "Index depth: full (all+semantic), moderate (filtered+semantic), fast (filtered only), cross-repo-intelligence (cross-project routes). index mode only. Default: full.",
	})),
	target_projects: Type.Optional(Type.Array(Type.String(), {
		description: "Projects for cross-repo linking. Use [\"*\"] for all. index mode cross-repo only.",
	})),
	persistence: Type.Optional(Type.Boolean({ description: "Write compressed artifact for team sharing. index mode only. Default: false." })),
	scope: Type.Optional(Type.String({ description: "Scope for change detection. detect_changes mode only." })),
	since: Type.Optional(Type.String({ description: "Git ref or date to compare from (e.g. HEAD~5, v0.5.0). detect_changes mode only." })),
	base_branch: Type.Optional(Type.String({ description: "Base branch for comparison. detect_changes mode only. Default: main." })),
	adr_action: Type.Optional(StringEnum(["create", "update", "list"] as const, {
		description: "ADR operation. adr mode only.",
	})),
	adr_data: Type.Optional(Type.String({ description: "JSON string with ADR content. adr mode create/update only." })),
	trace_data: Type.Optional(Type.String({ description: "JSON string of runtime traces to ingest. ingest_traces mode only." })),
}, { additionalProperties: false });

export type CbManageInput = Static<typeof CbManageSchema>;

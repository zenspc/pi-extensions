/**
 * pi-codebase-memory extension for pi.
 *
 * Replaces 14 MCP codebase-memory tools with 4 consolidated native pi tools,
 * reducing system prompt token overhead by ~75-80%.
 *
 * Tools:
 *   cb_search  - Search for code entities (graph, text, snippet, semantic)
 *   cb_query   - Run Cypher queries and trace call/data-flow paths
 *   cb_explore - Explore architecture, schema, projects, and index status
 *   cb_manage  - Index repos, delete projects, detect changes, manage ADRs
 *
 * Requires: codebase-memory-mcp binary installed at ~/.local/bin/codebase-memory-mcp
 * Install:  codebase-memory-mcp install
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CbSearchSchema,
	CbQuerySchema,
	CbExploreSchema,
	CbManageSchema,
} from "./types.ts";
import { executeSearch } from "./tool-search.ts";
import { executeQuery } from "./tool-query.ts";
import { executeExplore } from "./tool-explore.ts";
import { executeManage } from "./tool-manage.ts";
import { findBinary } from "./mcp-client.ts";

export default function codebaseMemoryExtension(pi: ExtensionAPI) {
	// ── Tool: cb_search ──────────────────────────────────────────────────

	pi.registerTool({
		name: "cb_search",
		label: "Codebase Search",
		description:
			"Search the codebase knowledge graph. Modes: graph (BM25 ranked entity search), code (grep with graph enrichment), snippet (read function/class source), semantic (vector cosine search).",
		promptSnippet:
			"Search the codebase knowledge graph for functions, classes, routes, and code patterns.",
		promptGuidelines: [
			"Use cb_search mode=graph for finding code entities by name or description (BM25 ranked).",
			"Use cb_search mode=code for text/pattern search enriched with graph metadata.",
			"Use cb_search mode=snippet to read source code for a specific function or class by qualified_name.",
			"Use cb_search mode=semantic when you need to bridge vocabulary (e.g. find 'publish' when searching 'send').",
		],
		parameters: CbSearchSchema,
		async execute(_toolCallId, params, signal) {
			const result = await executeSearch(params, signal);
			return {
				content: [{ type: "text", text: result.content }],
				details: { truncated: result.truncated },
			};
		},
	});

	// ── Tool: cb_query ───────────────────────────────────────────────────

	pi.registerTool({
		name: "cb_query",
		label: "Codebase Query",
		description:
			"Run advanced graph queries and trace execution paths. Modes: cypher (raw Cypher queries against the knowledge graph), trace (follow call/data-flow/cross-service paths from a function).",
		promptSnippet:
			"Run Cypher graph queries or trace call/data-flow paths through the codebase.",
		promptGuidelines: [
			"Use cb_query mode=cypher for complex multi-hop patterns, aggregations, and cross-service analysis via Cypher.",
			"Use cb_query mode=trace to find callers, callees, or data propagation from a specific function.",
		],
		parameters: CbQuerySchema,
		async execute(_toolCallId, params, signal) {
			const result = await executeQuery(params, signal);
			return {
				content: [{ type: "text", text: result.content }],
				details: { truncated: result.truncated },
			};
		},
	});

	// ── Tool: cb_explore ─────────────────────────────────────────────────

	pi.registerTool({
		name: "cb_explore",
		label: "Codebase Explore",
		description:
			"Explore codebase architecture and metadata. Modes: architecture (high-level overview with clusters), schema (graph node/edge types), projects (list indexed projects), status (indexing status).",
		promptSnippet:
			"Explore codebase architecture, list indexed projects, or check graph schema.",
		promptGuidelines: [
			"Use cb_explore mode=projects to discover available indexed projects before passing a project name to other cb_ tools.",
			"Use cb_explore mode=architecture for a high-level overview of packages, services, and dependencies.",
		],
		parameters: CbExploreSchema,
		async execute(_toolCallId, params, signal) {
			const result = await executeExplore(params, signal);
			return {
				content: [{ type: "text", text: result.content }],
				details: { truncated: result.truncated },
			};
		},
	});

	// ── Tool: cb_manage ──────────────────────────────────────────────────

	pi.registerTool({
		name: "cb_manage",
		label: "Codebase Manage",
		description:
			"Manage the codebase index. Modes: index (reindex a repository), delete (remove project), detect_changes (find changes since a ref), adr (manage Architecture Decision Records), ingest_traces (add runtime traces).",
		promptSnippet:
			"Index repositories, detect code changes, or manage Architecture Decision Records.",
		promptGuidelines: [
			"Use cb_manage mode=index to index or reindex a repository into the knowledge graph.",
			"Use cb_manage mode=detect_changes to find code changes and their impact since a git ref.",
		],
		parameters: CbManageSchema,
		async execute(_toolCallId, params, signal) {
			const result = await executeManage(params, signal);
			return {
				content: [{ type: "text", text: result.content }],
				details: { truncated: result.truncated },
			};
		},
	});

	// ── Startup check ────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const binary = findBinary();
		try {
			const { accessSync, constants } = require("node:fs");
			accessSync(binary, constants.X_OK);
		} catch {
			ctx.ui.notify(
				"codebase-memory-mcp not found. Install with: codebase-memory-mcp install",
				"warning",
			);
		}
	});
}

/**
 * cb_search - Code and graph search.
 *
 * Consolidates: search_graph, search_code, get_code_snippet, semantic_query
 */

import type { CbSearchInput } from "./types.ts";
import { callToolTruncated, type CliResult } from "./mcp-client.ts";

export async function executeSearch(
	params: CbSearchInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	switch (params.mode) {
		case "graph":
			return executeGraphSearch(params, signal);
		case "code":
			return executeCodeSearch(params, signal);
		case "snippet":
			return executeSnippet(params, signal);
		case "semantic":
			return executeSemantic(params, signal);
		default:
			throw new Error(`Unknown cb_search mode: ${params.mode}`);
	}
}

async function executeGraphSearch(
	params: CbSearchInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
	};

	if (params.query) args.query = params.query;
	if (params.label) args.label = params.label;
	if (params.name_pattern) args.name_pattern = params.name_pattern;
	if (params.file_pattern) args.file_pattern = params.file_pattern;
	if (params.limit) args.limit = params.limit;
	if (params.offset !== undefined) args.offset = params.offset;

	return callToolTruncated("search_graph", args, signal);
}

async function executeCodeSearch(
	params: CbSearchInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
		pattern: params.query,
	};

	if (params.file_pattern) args.file_pattern = params.file_pattern;
	if (params.regex !== undefined) args.regex = params.regex;
	if (params.mode_code) args.mode = params.mode_code;
	if (params.context !== undefined) args.context = params.context;
	if (params.limit) args.limit = params.limit;

	return callToolTruncated("search_code", args, signal);
}

async function executeSnippet(
	params: CbSearchInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
		qualified_name: params.query,
	};

	if (params.include_neighbors !== undefined) args.include_neighbors = params.include_neighbors;

	return callToolTruncated("get_code_snippet", args, signal);
}

async function executeSemantic(
	params: CbSearchInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const keywords = params.semantic_keywords ?? [params.query];
	const args: Record<string, unknown> = {
		project: params.project,
		semantic_query: keywords,
	};

	if (params.limit) args.limit = params.limit;

	return callToolTruncated("search_graph", args, signal);
}

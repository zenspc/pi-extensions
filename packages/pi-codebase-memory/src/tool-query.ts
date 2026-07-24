/**
 * cb_query - Graph queries and path tracing.
 *
 * Consolidates: query_graph, trace_path
 */

import type { CbQueryInput } from "./types.ts";
import { callToolTruncated, type CliResult } from "./mcp-client.ts";

export async function executeQuery(
	params: CbQueryInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	switch (params.mode) {
		case "cypher":
			return executeCypher(params, signal);
		case "trace":
			return executeTrace(params, signal);
		default:
			throw new Error(`Unknown cb_query mode: ${params.mode}`);
	}
}

async function executeCypher(
	params: CbQueryInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
		query: params.query,
	};

	if (params.max_rows) args.max_rows = params.max_rows;

	return callToolTruncated("query_graph", args, signal);
}

async function executeTrace(
	params: CbQueryInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
		function_name: params.query,
	};

	if (params.direction) args.direction = params.direction;
	if (params.depth) args.depth = params.depth;
	if (params.trace_mode) args.mode = params.trace_mode;
	if (params.parameter_name) args.parameter_name = params.parameter_name;
	if (params.risk_labels !== undefined) args.risk_labels = params.risk_labels;
	if (params.include_tests !== undefined) args.include_tests = params.include_tests;

	return callToolTruncated("trace_path", args, signal);
}

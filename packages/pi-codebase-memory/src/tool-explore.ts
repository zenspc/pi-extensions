/**
 * cb_explore - Architecture and schema exploration.
 *
 * Consolidates: get_architecture, get_graph_schema, list_projects, index_status
 */

import type { CbExploreInput } from "./types.ts";
import { callToolTruncated, type CliResult } from "./mcp-client.ts";

export async function executeExplore(
	params: CbExploreInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	switch (params.mode) {
		case "architecture":
			return executeArchitecture(params, signal);
		case "schema":
			return executeSchema(params, signal);
		case "projects":
			return executeProjects(signal);
		case "status":
			return executeStatus(params, signal);
		default:
			throw new Error(`Unknown cb_explore mode: ${params.mode}`);
	}
}

async function executeArchitecture(
	params: CbExploreInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	if (!params.project) {
		throw new Error("project is required for architecture mode");
	}

	const args: Record<string, unknown> = {
		project: params.project,
	};

	if (params.aspects) args.aspects = params.aspects;

	return callToolTruncated("get_architecture", args, signal);
}

async function executeSchema(
	_params: CbExploreInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	return callToolTruncated("get_graph_schema", {}, signal);
}

async function executeProjects(
	signal?: AbortSignal,
): Promise<CliResult> {
	return callToolTruncated("list_projects", {}, signal);
}

async function executeStatus(
	params: CbExploreInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	if (!params.project) {
		throw new Error("project is required for status mode");
	}

	return callToolTruncated("index_status", { project: params.project }, signal);
}

/**
 * cb_manage - Index and manage operations.
 *
 * Consolidates: index_repository, delete_project, detect_changes, manage_adr, ingest_traces
 */

import type { CbManageInput } from "./types.ts";
import { callToolTruncated, type CliResult } from "./mcp-client.ts";

export async function executeManage(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	switch (params.mode) {
		case "index":
			return executeIndex(params, signal);
		case "delete":
			return executeDelete(params, signal);
		case "detect_changes":
			return executeDetectChanges(params, signal);
		case "adr":
			return executeAdr(params, signal);
		case "ingest_traces":
			return executeIngestTraces(params, signal);
		default:
			throw new Error(`Unknown cb_manage mode: ${params.mode}`);
	}
}

async function executeIndex(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		repo_path: params.repo_path ?? params.project,
	};

	if (params.index_mode) args.mode = params.index_mode;
	if (params.target_projects) args.target_projects = params.target_projects;
	if (params.persistence !== undefined) args.persistence = params.persistence;

	return callToolTruncated("index_repository", args, signal);
}

async function executeDelete(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	return callToolTruncated("delete_project", { project: params.project }, signal);
}

async function executeDetectChanges(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
	};

	if (params.scope) args.scope = params.scope;
	if (params.since) args.since = params.since;
	if (params.base_branch) args.base_branch = params.base_branch;

	return callToolTruncated("detect_changes", args, signal);
}

async function executeAdr(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
	};

	if (params.adr_action) args.action = params.adr_action;
	if (params.adr_data) {
		try {
			args.data = JSON.parse(params.adr_data);
		} catch {
			args.data = params.adr_data;
		}
	}

	return callToolTruncated("manage_adr", args, signal);
}

async function executeIngestTraces(
	params: CbManageInput,
	signal?: AbortSignal,
): Promise<CliResult> {
	const args: Record<string, unknown> = {
		project: params.project,
	};

	if (params.trace_data) {
		try {
			args.traces = JSON.parse(params.trace_data);
		} catch {
			args.traces = params.trace_data;
		}
	}

	return callToolTruncated("ingest_traces", args, signal);
}

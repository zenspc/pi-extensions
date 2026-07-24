/**
 * Lightweight wrapper around codebase-memory-mcp CLI.
 *
 * Uses the binary's `cli <tool> <json>` subcommand to call tools directly,
 * bypassing MCP JSON-RPC protocol overhead. This is simpler and more
 * token-efficient than maintaining a persistent MCP connection.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

const BINARY = "codebase-memory-mcp";

/** Result from a CLI tool call. */
export type CliResult = {
	content: string;
	truncated: boolean;
	totalLines?: number;
	totalBytes?: number;
};

/**
 * Locate the codebase-memory-mcp binary.
 *
 * Uses the known install path from mcp.json.
 */
export function findBinary(): string {
	return `${process.env.HOME}/.local/bin/${BINARY}`;
}

/**
 * Call a codebase-memory-mcp tool via the CLI subcommand.
 *
 * @param tool - Tool name (e.g. "search_graph")
 * @param args - Arguments object (will be JSON-serialized)
 * @param signal - Optional abort signal
 * @returns The tool result as a string
 */
export async function callTool(
	tool: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const binary = findBinary();
	const jsonArgs = JSON.stringify(args);

	const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
		const proc = spawn(binary, ["cli", tool, jsonArgs], {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("close", (code: number | null) => {
			resolve({ stdout, stderr, code: code ?? 1 });
		});

		proc.on("error", (err: Error) => {
			reject(err);
		});
	});

	if (result.code !== 0) {
		// Filter out log lines from stderr (level=info/level=warn)
		const errorLines = result.stderr
			.split("\n")
			.filter((line: string) => line && !line.startsWith("level="))
			.join("\n")
			.trim();

		// Some tools return errors as JSON in stdout
		if (result.stdout.trim().startsWith("{")) {
			return result.stdout.trim();
		}

		throw new Error(
			errorLines || `codebase-memory-mcp exited with code ${result.code}`,
		);
	}

	return result.stdout.trim();
}

/**
 * Call a tool and return a truncated, pi-friendly result.
 *
 * Applies head truncation to prevent context overflow, and writes
 * full output to a temp file if truncated.
 */
export async function callToolTruncated(
	tool: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
	maxLines: number = DEFAULT_MAX_LINES,
	maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<CliResult> {
	const raw = await callTool(tool, args, signal);

	const truncation = truncateHead(raw, { maxLines, maxBytes });

	if (truncation.truncated) {
		const tmpDir = await mkdtemp(join(tmpdir(), "cb-memory-"));
		const tmpFile = join(tmpDir, `${tool}-output.json`);
		writeFileSync(tmpFile, raw);

		const content = `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Full output saved to: ${tmpFile}]`;

		return {
			content,
			truncated: true,
			totalLines: truncation.totalLines,
			totalBytes: truncation.totalBytes,
		};
	}

	return {
		content: truncation.content,
		truncated: false,
	};
}

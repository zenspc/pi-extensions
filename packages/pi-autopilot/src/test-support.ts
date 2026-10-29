import { ModelsSchema, validate, type TaskInput } from "./schema.ts";

export const models = validate(ModelsSchema, {
	version: 1, discoveredAt: new Date().toISOString(), available: ["cheap/fast", "frontier/deep", "backup/fast"],
	tiers: Object.fromEntries(["scout", "fast", "standard", "deep", "reviewer"].map((tier) => [tier, {
		primary: tier === "deep" ? "frontier/deep" : "cheap/fast", fallbacks: ["backup/fast"],
	}])),
});
export function input(id = "task-1", overrides: Partial<TaskInput> = {}): TaskInput {
	return {
		id, title: "Implement the requested change", description: "Implement the change with a regression test",
		dependencies: [], role: "coder", complexityTier: "fast", model: "cheap/fast", thinkingLevel: "low",
		allowedTools: "read,write,edit,bash,grep", filesToTouch: [`${id}.txt`], verificationCommand: "test -f task-1.txt", ...overrides,
	};
}

export function resultTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block) => block?.type === "text" && typeof block.text === "string"
		)
		.map((block) => block.text)
		.join("\n");
}

export function resultIsImageFromContent(content: unknown): boolean {
	return (
		Array.isArray(content) &&
		content.some((block) => block?.type === "image")
	);
}

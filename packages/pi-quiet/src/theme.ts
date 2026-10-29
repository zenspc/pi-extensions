import {
	Theme,
	type ThemeBg,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";

/** Transient palette: applying Quiet must not overwrite the user's saved theme preference. */
export function quietTheme(previous: Theme): Theme {
	const light = previous.appearance === "light";
	const text = light ? "#242424" : "#e1e1e1";
	const muted = light ? "#626262" : "#929292";
	const dim = light ? "#767676" : "#777777";
	const purple = light ? "#7853ad" : "#bb9af7";
	const blue = light ? "#315eae" : "#7aa2f7";
	const green = light ? "#41752b" : "#9ece6a";
	const red = light ? "#b32f46" : "#f7768e";
	const orange = light ? "#995017" : "#ff9e64";
	const border = light ? "#ababaf" : "#505058";
	const foreground: Record<ThemeColor, string> = {
		accent: purple,
		border,
		borderAccent: border,
		borderMuted: dim,
		success: green,
		error: red,
		warning: orange,
		muted,
		dim,
		text,
		thinkingText: muted,
		userMessageText: text,
		customMessageText: text,
		customMessageLabel: purple,
		toolTitle: text,
		toolOutput: muted,
		mdHeading: purple,
		mdLink: blue,
		mdLinkUrl: muted,
		mdCode: blue,
		mdCodeBlock: text,
		mdCodeBlockBorder: border,
		mdQuote: muted,
		mdQuoteBorder: border,
		mdHr: border,
		mdListBullet: muted,
		toolDiffAdded: green,
		toolDiffRemoved: red,
		toolDiffContext: muted,
		syntaxComment: dim,
		syntaxKeyword: purple,
		syntaxFunction: blue,
		syntaxVariable: text,
		syntaxString: green,
		syntaxNumber: orange,
		syntaxType: blue,
		syntaxOperator: muted,
		syntaxPunctuation: muted,
		thinkingOff: border,
		thinkingMinimal: border,
		thinkingLow: border,
		thinkingMedium: border,
		thinkingHigh: border,
		thinkingXhigh: border,
		thinkingMax: border,
		bashMode: orange,
		scrollbarTrack: border,
		scrollbarThumb: muted,
		searchMatchText: text,
	};
	const background: Record<ThemeBg, string> = {
		selectedBg: light ? "#e2e2e8" : "#303038",
		userMessageBg: light ? "#eeeeee" : "#1c1c1c",
		customMessageBg: "",
		toolPendingBg: "",
		toolSuccessBg: "",
		toolErrorBg: "",
		searchMatchBg: light ? "#ead6aa" : "#574629",
	};
	return new Theme(foreground, background, previous.getColorMode(), {
		name: "pi-quiet",
		appearance: previous.appearance,
	});
}

// 上下文窗口占用估算：ACP/headless 均不暴露真实占用（探测结论），按字符范围加权估算
// 比 chars/4 更准：CJK 字符按 ~0.75 token/字计算（BPE 分词经验值）
export const CONTEXT_WINDOWS: Record<string, number> = {
  kimi: 1_048_576,   // k3 = 1M；kimi-for-coding = 256k（取大值偏保守）
  claude: 200_000,
  gemini: 1_000_000,
  codex: 400_000,
  qwen: 262_144,
  opencode: 200_000,
  aider: 200_000,
  pi: 200_000,
};

// 按字符范围加权估算 token 数（与主进程 shared.estimateTokens 同口径）
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      // ASCII：~4 字符/token
      tokens += 0.25;
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) ||  // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4dbf) ||  // CJK 扩展 A
      (code >= 0x3040 && code <= 0x30ff) ||  // 平假名 + 片假名
      (code >= 0xac00 && code <= 0xd7af)     // 韩文音节
    ) {
      // CJK：~1.3 字符/token
      tokens += 0.75;
    } else {
      // 其他 Unicode：~2 字符/token
      tokens += 0.5;
    }
  }
  return Math.max(1, Math.round(tokens));
}

export function estimateContextUsage(
  task: { cli: string; messages: Array<{ text: string }> },
  contextWindowOverride?: number,
): {
  used: number;
  max: number;
  pct: number;
} {
  const text = task.messages.map((m) => m.text).join('');
  const used = estimateTokens(text);
  // 优先使用模型自带 contextWindow（用户在添加模型时设置），未提供时回退到 CLI 默认值
  const max = contextWindowOverride ?? CONTEXT_WINDOWS[task.cli] ?? 200_000;
  return { used, max, pct: Math.round((used / max) * 100) };
}

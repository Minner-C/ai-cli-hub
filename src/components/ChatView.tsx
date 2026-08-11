// 聊天视图：消息气泡 + 工具调用折叠块 + 输入框 + 顶栏（CLI 标识/切换/目录）
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import MarkdownView from './MarkdownView';
import SwitchCliDialog from './SwitchCliDialog';
import PlusPopover from './PlusPopover';
import ToolCard from './ToolCard';
import InputPanel from './InputPanel';
import ModelDropdown from './ModelDropdown';
import EffortSelector from './EffortSelector';
import PermissionSelector from './PermissionSelector';
import RoundNav from './RoundNav';
import ProviderSelector from './ProviderSelector';
import { ChevronRight, AlertCircle, RotateCcw, X, ImagePlus, PanelRight, PanelRightClose, ShieldQuestion } from 'lucide-react';
import { classifyError } from '../utils/errorClassify';
import { messageBlocks } from '../../electron/shared';
import { estimateContextUsage } from '../utils/context';
import { cleanDisplayText } from '../utils/displayText';
import type { ChatMessage, ContentBlock, Task } from '../../electron/shared';

// 思考过程：可折叠标签行（chevron + hover 反馈）；生成中自动展开，完成后自动折叠
function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation();
  // manual 为用户显式选择；未选择时跟随 streaming（生成中展开，完成折叠）
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? Boolean(streaming);
  // 思考块内部滚动：流式中自动置底；用户上滑打断（暂停跟随），回底恢复
  const bodyRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    if (open && streaming && followRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, streaming]);
  // 流式结束复位跟随
  useEffect(() => {
    if (!streaming) followRef.current = true;
  }, [streaming]);
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  // 字数提示（微弱）
  const charCount = text.trim().length;
  return (
    <div className="thinking-block" onClick={() => setManual(!open)}>
      <div className="thinking-head">
        <span className={`thinking-chevron ${open ? 'open' : ''}`}>
          <ChevronRight size={13} />
        </span>
        {t('chat.thinking')}
        {charCount > 0 && <span className="thinking-count">{charCount}</span>}
        {streaming && <span className="thinking-dots"><i /><i /><i /></span>}
      </div>
      {open && (
        <pre ref={bodyRef} className="thinking-body" onScroll={onBodyScroll} onClick={(e) => e.stopPropagation()}>
          {cleanDisplayText(text)}
        </pre>
      )}
    </div>
  );
}

// 把 tool 内容块包装成 ToolCard 需要的消息形状
function toolBlockToMsg(block: Extract<ContentBlock, { type: 'tool' }>): ChatMessage {
  return {
    id: block.toolId,
    role: 'tool',
    text: block.result ?? '',
    toolName: block.name,
    toolArgs: block.args,
    toolStatus: block.status,
    ts: 0,
  };
}

// 有序渲染内容块：text→markdown、thinking→折叠块、tool→工具卡片
function Blocks({ msg, cwd, onImageClick }: { msg: ChatMessage; cwd?: string; onImageClick?: (dataUrl: string) => void }) {
  const blocks = messageBlocks(msg);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return block.text ? <MarkdownView key={i} text={block.text} cwd={cwd} onImageClick={onImageClick} /> : null;
        }
        if (block.type === 'thinking') {
          if (!block.text.trim()) return null; // 空思考块不渲染
          // 只有最后一个块且仍在流式时才显示加载动画；后续块到达/done 后思考视为完成
          const thinkingActive = Boolean(msg.streaming) && i === blocks.length - 1;
          return <ThinkingBlock key={i} text={block.text} streaming={thinkingActive} />;
        }
        return <ToolCard key={i} msg={toolBlockToMsg(block)} cwd={cwd} />;
      })}
    </>
  );
}

// 模型调用失败：内联错误块（淡红底 + 图标 + 摘要 + 可展开原文 + 重试）
function ErrorBlock({ msg, taskId }: { msg: ChatMessage; taskId: string }) {
  const { t } = useTranslation();
  const { send, runningTaskIds } = useHubStore();
  const [expanded, setExpanded] = useState(false);
  const kind = classifyError(msg.text);
  const running = runningTaskIds.has(taskId);

  return (
    <div className="error-block">
      <div className="error-head" onClick={() => setExpanded(!expanded)}>
        <AlertCircle size={14} className="error-icon" />
        <span className="error-title">{t('error.title')}</span>
        <span className="error-kind">{t(`error.${kind}`)}</span>
        {msg.retryText && !running && (
          <button
            className="error-retry"
            onClick={(e) => {
              e.stopPropagation();
              void send(taskId, msg.retryText!);
            }}
          >
            <RotateCcw size={12} /> {t('error.retry')}
          </button>
        )}
        <span className="tool-row-chevron">
          {expanded ? '▾' : '▸'}
        </span>
      </div>
      {expanded && <pre className="error-detail">{msg.text}</pre>}
    </div>
  );
}

const MessageItem = memo(function MessageItem({ msg, cwd, showCursor, taskId, onImageClick }: { msg: ChatMessage; cwd?: string; showCursor?: boolean; taskId?: string; onImageClick?: (dataUrl: string) => void }) {
  if (msg.role === 'tool') return <ToolCard msg={msg} cwd={cwd} />;
  if (msg.role === 'system') {
    if (msg.error && taskId) return <ErrorBlock msg={msg} taskId={taskId} />;
    return (
      <div className="msg msg-system">
        <pre>{msg.text}</pre>
      </div>
    );
  }
  // 流式占位但尚无任何内容（等待首包）→ 显示等待动画
  const isEmpty =
    !msg.text.trim() &&
    (!msg.blocks ||
      msg.blocks.every(
        (b) => (b.type === 'text' || b.type === 'thinking') && !b.text.trim(),
      ));
  return (
    <div className={`msg msg-${msg.role}`}>
      {msg.images && msg.images.length > 0 && (
        <div className="msg-images">
          {msg.images.map((img, i) => (
            <img key={i} src={img.dataUrl} alt={img.name} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} onClick={() => onImageClick?.(img.dataUrl)} />
          ))}
        </div>
      )}
      <Blocks msg={msg} cwd={cwd} onImageClick={onImageClick} />
      {msg.streaming && isEmpty && (
        <span className="waiting-indicator">
          <span className="waiting-dot" />
          <span className="waiting-dot" />
          <span className="waiting-dot" />
        </span>
      )}
      {showCursor && msg.streaming && !isEmpty && <span className="cursor-blink">▍</span>}
    </div>
  );
}, (prev, next) => prev.msg === next.msg && prev.cwd === next.cwd && prev.showCursor === next.showCursor && prev.taskId === next.taskId);

// 上下文占用指示：圆环，悬浮显示精确用量
function ContextRing({ task }: { task: Task }) {
  const { t } = useTranslation();
  // 优先使用模型自带的 contextWindow（用户在添加模型时设置）
  const modelEntries = useHubStore((s) => s.modelEntries);
  const entry = task.modelEntryId ? modelEntries.find((e) => e.id === task.modelEntryId) : undefined;
  const { used, max, pct } = estimateContextUsage(task, entry?.contextWindow);
  const fmtK = (n: number) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const r = 9;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, pct) / 100) * c;
  const warn = pct > 80;
  // 悬浮显示精确用量；无内容时仍占位（保持工具栏布局稳定）
  const title = used === 0
    ? t('context.empty')
    : `${t('context.label')}: ${pct}% · ${fmtK(used)}/${fmtK(max)} ${t('context.tokens')}\n${t('context.estimated')}`;
  return (
    <span className={`ctx-ring ${warn ? 'warn' : ''}`} title={title}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--bg-hover)" strokeWidth="2.5" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      {used > 0 && <span className="ctx-ring-pct">{pct}</span>}
    </span>
  );
}

// 权限审批卡片（TRAE 极简：图标 + 工具名 + 参数摘要 + 选项按钮组）
function PermissionCard({ req }: { req: import('../../electron/shared').PermissionRequestPayload }) {
  const { t } = useTranslation();
  const { respondPermission, resolvedPermissions } = useHubStore();
  const chosen = resolvedPermissions[req.requestId];
  // 方案选择类（ExitPlanMode 等带完整方案内容）：选项列表卡片，选项文案用原文
  const isPlan = Boolean(req.planContent);
  return (
    <div className={`perm-card ${isPlan ? 'perm-plan' : ''}`}>
      <div className="perm-head">
        <ShieldQuestion size={14} className="perm-icon" />
        <span className="perm-title">{isPlan ? t('permission.planTitle') : t('permission.title')}</span>
        {!isPlan && <strong>{req.toolName}</strong>}
      </div>
      {isPlan && req.planContent && (
        <div className="perm-plan-content">
          <MarkdownView text={req.planContent} cwd={undefined} />
        </div>
      )}
      {!isPlan && req.summary && <div className="perm-summary mono">{req.summary}</div>}
      <div className={isPlan ? 'perm-options-list' : 'perm-options'}>
        {req.options.map((opt) => {
          const isChosen = chosen === opt.optionId;
          if (isPlan) {
            // 选择类：竖排选项行（标题+描述），单选点击回传
            return (
              <div
                key={opt.optionId}
                className={`perm-option-row ${isChosen ? 'chosen' : ''} ${chosen ? 'locked' : ''}`}
                onClick={() => !chosen && void respondPermission(req.requestId, opt.optionId)}
              >
                <span className="perm-option-name">{opt.name}</span>
                {opt.description && <span className="perm-option-desc">{opt.description}</span>}
              </div>
            );
          }
          return (
            <button
              key={opt.optionId}
              className={`perm-btn perm-${opt.kind} ${isChosen ? 'chosen' : ''}`}
              disabled={Boolean(chosen)}
              onClick={() => void respondPermission(req.requestId, opt.optionId)}
            >
              {t(`permission.${opt.kind}`, { defaultValue: opt.name })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ChatView({ task }: { task: Task }) {
  const { t } = useTranslation();
  // 轮次定位数据：每轮 = 一条用户消息
  const rounds = useMemo(
    () =>
      task.messages
        .filter((m) => m.role === 'user' && m.text.trim())
        .map((m) => ({ id: m.id, title: m.text.trim().replace(/\s+/g, ' ').slice(0, 40) })),
    [task.messages],
  );
  const { clis, runningTaskIds, send, stop, rightPanelOpen, toggleRightPanel, pendingPermissions, respondPermission, resolvedPermissions } = useHubStore();
  const [input, setInput] = useState('');
  const [switchOpen, setSwitchOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ data: string; mimeType: string; name: string; dataUrl: string }>>([]);
  const [bigImage, setBigImage] = useState<string | null>(null);


  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 自动置底状态：true=跟随流式滚动到底；用户上滑离开底部超过阈值时置 false
  const [autoBottom, setAutoBottom] = useState(true);
  const autoBottomRef = useRef(true);
  autoBottomRef.current = autoBottom;
  const [showJump, setShowJump] = useState(false);
  const running = runningTaskIds.has(task.id);

  const cliName = clis.find((c) => c.id === task.cli)?.displayName ?? task.cli;

  const THRESHOLD = 80;

  // 滚动监听：距底超阈值打断，回底恢复
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = dist < THRESHOLD;
      setAutoBottom(atBottom);
      setShowJump(!atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 流式/新消息：仅在自动置底态滚动
  useEffect(() => {
    if (autoBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task.messages.length, task.messages[task.messages.length - 1]?.text]);

  // done 时若用户在底部附近则置底一次
  useEffect(() => {
    if (!running && autoBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [running]);

  // 新审批到达：自动置底态时滚到底（审批卡片可见）
  const taskPending = pendingPermissions.filter((r) => r.taskId === task.id);
  useEffect(() => {
    if (taskPending.length > 0 && autoBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [taskPending.length]);

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoBottom(true);
    setShowJump(false);
  };

  const doSend = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || running) return;
    setInput('');
    const images = attachments.map((a) => ({ data: a.data, mimeType: a.mimeType, name: a.name }));
    setAttachments([]);
    void send(task.id, text, images);
  };

  // 图片读取为附件
  const addImageFiles = (files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith('image/') || file.size === 0) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setAttachments((a) => [
          ...a,
          { data: dataUrl.split(',')[1] ?? '', mimeType: file.type, name: file.name, dataUrl },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  // 粘贴：优先 clipboardData.files；拿不到（微信截图等）回退主进程原生剪贴板
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])].filter(
      (f) => f.type.startsWith('image/') && f.size > 0,
    );
    if (files.length > 0) {
      e.preventDefault();
      addImageFiles(files);
      return;
    }
    // 剪贴板含图片但 Chromium 未暴露为有效 File（微信截图常见）——走原生读取
    const hasImageItem = [...(e.clipboardData?.items ?? [])].some((it) =>
      it.type.startsWith('image/'),
    );
    if (hasImageItem) {
      e.preventDefault();
      void window.hub.readClipboardImage().then((img) => {
        if (!img) return;
        const dataUrl = `data:${img.mimeType};base64,${img.data}`;
        setAttachments((a) => [
          ...a,
          { data: img.data, mimeType: img.mimeType, name: 'clipboard.png', dataUrl },
        ]);
      });
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-topbar">
        <span className="cli-badge">{cliName}</span>
        <ProviderSelector cliId={task.cli} />
        <button className="secondary" onClick={() => setSwitchOpen(true)} disabled={running}>
          {t('chat.switchCli')}
        </button>
        <span className="hint chat-cwd" title={task.cwd}>
          {task.cwd}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn right-panel-toggle"
          onClick={toggleRightPanel}
          title={rightPanelOpen ? t('panel.collapseRight') : t('panel.expandRight')}
        >
          {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
        </button>
      </div>

      <div className="chat-messages-wrap">
        <div className="chat-messages" ref={scrollRef}>
        {task.messages.length === 0 && <div className="empty-state">{t('chat.empty')}</div>}
        {task.messages.map((m, i) => (
          <div key={m.id} data-mid={m.id} className="msg-anchor">
            <MessageItem
              msg={m}
              cwd={task.cwd}
              taskId={task.id}
              onImageClick={setBigImage}
              showCursor={running && i === task.messages.length - 1}
            />
          </div>
        ))}
        {pendingPermissions
          .filter((r) => r.taskId === task.id)
          .map((r) => (
            <PermissionCard key={r.requestId} req={r} />
          ))}
        <div ref={bottomRef} />
        </div>

        {/* 轮次快速定位（仅对话显示区） */}
        <RoundNav rounds={rounds} containerRef={scrollRef} />
      </div>

      {showJump && (
        <button className="jump-bottom" onClick={jumpToBottom}>
          ↓ {t('chat.jumpToBottom')}
          {running && <span className="jump-dot" />}
        </button>
      )}

      {/* 附件条 */}
      {attachments.length > 0 && (
        <div className="attach-bar">
          {attachments.map((a, i) => (
            <span key={i} className="attach-item">
              <img src={a.dataUrl} alt={a.name} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} onClick={() => setBigImage(a.dataUrl)} />
              <button className="attach-del" onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 输入框上方任务面板：待办清单 + 文件变更统计，随消息流同步更新 */}
      <InputPanel key={task.id} task={task} />

      {/* 输入卡片：圆角大卡片 + 底部工具栏（＋ / 模型 pill / 发送） */}
      <div
        className="chat-input-card"
        onDrop={(e) => {
          e.preventDefault();
          addImageFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <textarea
          value={input}
          onPaste={handlePaste}
          placeholder={t('chat.inputPlaceholder')}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              doSend();
            }
          }}
        />
        <div className="chat-input-toolbar">
          <PlusPopover cliId={task.cli} cwd={task.cwd} />
          <PermissionSelector
            cliId={task.cli}
            taskId={task.id}
            current={task.permission}
            disabled={running}
          />
          <span style={{ flex: 1 }} />
          <EffortSelector
            cliId={task.cli}
            taskId={task.id}
            current={task.effort}
            disabled={running}
          />
          <ModelDropdown
            taskId={task.id}
            taskCli={task.cli}
            currentEntryId={task.modelEntryId}
            taskModel={task.model}
            disabled={running}
            onAddModel={() => useHubStore.getState().setSettingsOpen(true)}
          />
          <ContextRing task={task} />
          {running ? (
            <button className="danger send-btn" onClick={() => void stop(task.id)}>
              {t('chat.stop')}
            </button>
          ) : (
            <button className="send-btn" onClick={doSend} disabled={!input.trim()}>
              {t('chat.send')}
            </button>
          )}
        </div>
      </div>

      {switchOpen && <SwitchCliDialog task={task} onClose={() => setSwitchOpen(false)} />}
      {bigImage && (
        <div className="dialog-overlay" onClick={() => setBigImage(null)}>
          <img className="big-image" src={bigImage} alt="" />
        </div>
      )}
    </div>
  );
}

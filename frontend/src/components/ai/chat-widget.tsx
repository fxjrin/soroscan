import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocation } from "react-router";
import { Address } from "@/components/address";
import { AiAnalysisView } from "@/components/ai/analysis";
import { AssetIcon } from "@/components/asset-icon";
import {
  CloseGlyph,
  EyeGlyph,
  EyeOffGlyph,
  SendGlyph,
  UserGlyph,
} from "@/components/ai/icons";
import { AiRichText } from "@/components/ai/rich-text";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AiRef } from "@/lib/ai/client";
import {
  firstRefIn,
  GENERAL_SUGGESTIONS,
  kindLabel,
  routeEntityFromPath,
  suggestionsFor,
} from "@/lib/ai/entity";
import { useAiChat } from "@/lib/ai/use-ai-chat";
import { ACTIVE_NETWORK, NETWORKS } from "@/lib/network";
import { cn } from "@/lib/utils";

export function AiChatWidget() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [mutedRoute, setMutedRoute] = useState<string | null>(null);
  const chat = useAiChat();
  const location = useLocation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const routeCtx = routeEntityFromPath(location.pathname);
  const routeKey = routeCtx ? `${routeCtx.kind}:${routeCtx.id}` : "";
  // the page's context is on by default; the eye mutes it for this one route,
  // and moving to another page starts fresh with it on
  const useRouteContext = routeKey !== "" && mutedRoute !== routeKey;
  // what the header bar and suggestions describe: the current page, or nothing
  // when its eye is off. never an earlier page, so the bar can't go stale
  const subject = useRouteContext ? routeCtx : null;

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [chat.turns]);

  function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || chat.pending) {
      return;
    }
    // the eye only governs the page you are on; the conversation still
    // remembers the entity it has been about, so a follow-up ("when was that")
    // stays answerable with fresh on-chain data even when the page is ignored
    const context =
      useRouteContext && routeCtx
        ? routeCtx
        : (firstRefIn(trimmed) ?? chat.activeEntity);
    chat.ask(trimmed, context, ACTIVE_NETWORK);
    setDraft("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Ask Soroscan AI"
        onClick={() => setOpen(true)}
        className="ai-orb-btn fixed right-4 bottom-4 z-50 size-14 rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="ai-orb" aria-hidden="true">
          <span className="ai-orb-face">
            <LogoMark
              size={30}
              className="text-foreground"
              starClassName="ai-orb-star"
            />
          </span>
          <span className="ai-orb-ring" />
        </span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Soroscan AI"
      className="fixed right-4 bottom-4 z-50 flex h-[32rem] max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <LogoMark size={18} className="text-foreground" />
        <span className="text-sm font-semibold">Soroscan AI</span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <CloseGlyph className="size-4" />
        </button>
      </div>

      {routeCtx ? (
        <ContextBar
          subject={routeCtx}
          active={useRouteContext}
          onToggle={() => setMutedRoute(useRouteContext ? routeKey : null)}
        />
      ) : null}

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-3"
      >
        {chat.turns.length === 0 ? (
          <EmptyState context={subject} onPick={send} />
        ) : (
          chat.turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              <div className="flex justify-end gap-2">
                <AiRichText
                  text={turn.question}
                  className="max-w-[78%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm"
                />
                <UserAvatar />
              </div>
              <div className="flex gap-2">
                <SoroscanAvatar />
                <div className="min-w-0 flex-1 pt-1">
                  {turn.status === "pending" ? <PendingRow /> : null}
                  {turn.status === "error" ? (
                    <ErrorRow
                      message={turn.error}
                      onRetry={() => chat.retry(turn.id)}
                    />
                  ) : null}
                  {turn.status === "done" && turn.analysis ? (
                    <AiAnalysisView analysis={turn.analysis} />
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKey}
            rows={1}
            aria-label="Ask a question"
            placeholder={
              subject
                ? `Ask about this ${subject.kind}, or anything...`
                : "Ask about a tx, account, contract, or Stellar itself..."
            }
            className="max-h-28 min-h-9 flex-1 resize-none rounded-xl focus-visible:ring-2 focus-visible:ring-ring/35"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            className="size-9 shrink-0 rounded-full"
            disabled={draft.trim() === "" || chat.pending}
          >
            <SendGlyph className="size-[18px]" />
          </Button>
        </div>
      </form>
    </div>
  );
}

function ContextBar({
  subject,
  active,
  onToggle,
}: {
  subject: AiRef;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        title={
          active
            ? "Answering about this page. Click to ignore it."
            : "Ignoring this page. Click to use it as context."
        }
        aria-label={
          active ? "Using this page as context" : "Ignoring this page"
        }
        className="-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted"
      >
        {active ? (
          <EyeGlyph className="size-4 text-primary" />
        ) : (
          <EyeOffGlyph className="size-4 text-muted-foreground" />
        )}
      </button>
      <span className={cn("flex items-center gap-2", !active && "opacity-45")}>
        <span className="font-medium">{kindLabel(subject.kind)}</span>
        {subject.kind === "asset" ? (
          <AssetContext id={subject.id} />
        ) : (
          <Address value={subject.id} className="text-xs" />
        )}
      </span>
      <span className="ml-auto text-muted-foreground">
        {NETWORKS[ACTIVE_NETWORK].label}
      </span>
    </div>
  );
}

function AssetContext({ id }: { id: string }) {
  const dash = id.indexOf("-");
  const code = dash < 0 ? id : id.slice(0, dash);
  const issuer = dash < 0 ? undefined : id.slice(dash + 1);
  return (
    <span className="inline-flex items-center gap-1.5">
      <AssetIcon code={code} issuer={issuer} size={16} />
      <span className="font-mono">{code}</span>
    </span>
  );
}

function EmptyState({
  context,
  onPick,
}: {
  context: AiRef | null;
  onPick: (question: string) => void;
}) {
  const suggestions = context
    ? suggestionsFor(context.kind)
    : GENERAL_SUGGESTIONS;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {context
          ? `Ask about this ${context.kind}, or anything on Stellar. Try:`
          : "Ask me anything about Stellar or Soroban, or mention an id. Try:"}
      </p>
      <div className="flex flex-col gap-2">
        {suggestions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onPick(question)}
            className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

function SoroscanAvatar() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center self-start rounded-full border border-border bg-muted">
      <LogoMark size={16} className="text-foreground" />
    </span>
  );
}

function UserAvatar() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center self-start rounded-full border border-border bg-muted text-muted-foreground">
      <UserGlyph className="size-4" />
    </span>
  );
}

function PendingRow() {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5"
      aria-live="polite"
      aria-label="Thinking"
    >
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
    </div>
  );
}

function ErrorRow({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {message ?? "Something went wrong. Try again."}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

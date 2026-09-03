import { useCallback, useMemo, useRef, useState } from "react";
import {
  AiError,
  askAi,
  type AiAnalysis,
  type AiHistoryTurn,
  type AiRef,
} from "@/lib/ai/client";
import { firstRefIn } from "@/lib/ai/entity";
import type { NetworkId } from "@/lib/network";

export interface AiTurn {
  id: number;
  question: string;
  context: AiRef | null;
  network: NetworkId;
  status: "pending" | "done" | "error";
  analysis?: AiAnalysis;
  error?: string;
}

export interface AiChat {
  turns: AiTurn[];
  pending: boolean;
  activeEntity: AiRef | null;
  ask: (question: string, context: AiRef | null, network: NetworkId) => void;
  retry: (turnId: number) => void;
}

const HISTORY_LIMIT = 5;
const ANSWER_LIMIT = 600;

function historyFrom(turns: AiTurn[], beforeId?: number): AiHistoryTurn[] {
  return turns
    .filter(
      (turn) =>
        turn.status === "done" &&
        turn.analysis !== undefined &&
        (beforeId === undefined || turn.id < beforeId),
    )
    .slice(-HISTORY_LIMIT)
    .map((turn) => ({
      question: turn.question,
      answer: turn.analysis!.summary.slice(0, ANSWER_LIMIT),
    }));
}

function messageFor(error: unknown): string {
  return error instanceof AiError
    ? error.message
    : "Something went wrong while analyzing.";
}

export function useAiChat(): AiChat {
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const nextId = useRef(1);

  const run = useCallback(
    async (
      turnId: number,
      question: string,
      context: AiRef | null,
      network: NetworkId,
      history: AiHistoryTurn[],
    ) => {
      try {
        const analysis = await askAi(question, network, context, history);
        setTurns((current) =>
          current.map((turn) =>
            turn.id === turnId ? { ...turn, status: "done", analysis } : turn,
          ),
        );
      } catch (error) {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === turnId
              ? { ...turn, status: "error", error: messageFor(error) }
              : turn,
          ),
        );
      }
    },
    [],
  );

  const ask = useCallback(
    (question: string, context: AiRef | null, network: NetworkId) => {
      const history = historyFrom(turns);
      const id = nextId.current++;
      setTurns((current) => [
        ...current,
        { id, question, context, network, status: "pending" },
      ]);
      void run(id, question, context, network, history);
    },
    [turns, run],
  );

  const retry = useCallback(
    (turnId: number) => {
      const turn = turns.find((item) => item.id === turnId);
      if (!turn) {
        return;
      }
      const history = historyFrom(turns, turnId);
      setTurns((current) =>
        current.map((item) =>
          item.id === turnId
            ? { ...item, status: "pending", error: undefined }
            : item,
        ),
      );
      void run(turn.id, turn.question, turn.context, turn.network, history);
    },
    [turns, run],
  );

  // the conversation subject: the most recent turn that named an entity, so a
  // follow-up with no id ("what has it been doing") still resolves.
  const activeEntity = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const ref = turns[i].context ?? firstRefIn(turns[i].question);
      if (ref) {
        return ref;
      }
    }
    return null;
  }, [turns]);

  const pending = turns.some((turn) => turn.status === "pending");

  return { turns, pending, activeEntity, ask, retry };
}

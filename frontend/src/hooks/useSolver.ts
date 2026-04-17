import { useCallback, useEffect, useState } from "react";
import { checkHealth, solveLp } from "../services/api";
import type { ChatMessage, LpResponse } from "../types/lp";

const EXAMPLE_PROMPT =
  "Minimize Z = 3x + 2y subject to: x + y <= 10, x >= 0, y >= 0";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content:
      "Paste any LP problem in English or French.\n\n" +
      "Example:\n" +
      EXAMPLE_PROMPT,
    timestamp: new Date()
  };
}

export function useSolver() {
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);
  const [loading, setLoading] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    let active = true;

    async function refreshHealth() {
      const status = await checkHealth();
      if (active) {
        setBackendOnline(status);
      }
    }

    refreshHealth();
    const timer = window.setInterval(refreshHealth, 12_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const sendProblem = useCallback(async (problemText: string) => {
    const normalized = problemText.trim();
    if (!normalized) {
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: "user",
        content: normalized,
        timestamp: new Date()
      }
    ]);

    setLoading(true);

    try {
      const response: LpResponse = await solveLp(normalized);

      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: response.explanation,
          timestamp: new Date(),
          lpResponse: response
        }
      ]);
    } catch (error: unknown) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message: string }).message === "string"
          ? (error as { message: string }).message
          : "Request failed";

      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "error",
          content: `Solver failed: ${message}`,
          timestamp: new Date()
        }
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([createWelcomeMessage()]);
  }, []);

  return {
    messages,
    loading,
    backendOnline,
    sendProblem,
    clearMessages
  };
}
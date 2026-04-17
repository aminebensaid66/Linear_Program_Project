import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types/lp";
import { SolutionCard } from "./SolutionCard";

type ChatMessageProps = {
  message: ChatMessage;
};

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const roleLabel = isUser ? "Analyst" : isError ? "System" : "Solver";

  return (
    <div className={`message-row ${isUser ? "user-row" : "assistant-row"}`}>
      {!isUser ? <div className="avatar assistant-avatar">S</div> : null}

      <div
        className={`message-bubble ${
          isUser ? "user-bubble" : isError ? "error-bubble" : "assistant-bubble"
        }`}
      >
        <div className="bubble-meta">{roleLabel}</div>

        {isUser ? (
          <pre className="problem-text">{message.content}</pre>
        ) : (
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}

        {message.lpResponse ? <SolutionCard response={message.lpResponse} /> : null}

        <span className="message-time">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </span>
      </div>

      {isUser ? <div className="avatar user-avatar">U</div> : null}
    </div>
  );
}
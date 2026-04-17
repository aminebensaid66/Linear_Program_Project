import { useEffect, useRef } from "react";
import { ChatInput } from "./components/ChatInput";
import { ChatMessageBubble } from "./components/ChatMessage";
import { useSolver } from "./hooks/useSolver";

export default function App() {
  const { messages, loading, sendProblem, clearMessages, backendOnline } = useSolver();
  const bottomRef = useRef<HTMLDivElement>(null);
  const userMessages = messages.filter((message) => message.role === "user").length;
  const solvedMessages = messages.filter((message) => Boolean(message.lpResponse)).length;
  const errorMessages = messages.filter((message) => message.role === "error").length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="app-stage">
      <div className="ambient-shape ambient-a" />
      <div className="ambient-shape ambient-b" />

      <div className="app-shell">
        <header className="app-header">
          <div className="header-brand">
            <div className="brand-icon">OR</div>
            <div>
              <h1 className="brand-title">OR Solver Studio</h1>
              <p className="brand-sub">Decision Intelligence Dashboard</p>
            </div>
          </div>

          <div className="header-actions">
            <div className={`status-badge ${backendOnline ? "online" : "offline"}`}>
              {backendOnline ? "System healthy" : "System degraded"}
            </div>
            <div className="counter-badge">Turns: {userMessages}</div>
            <button className="clear-button" onClick={clearMessages} type="button">
              New Session
            </button>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="chat-panel">
            <div className="top-banner">
              <p>
                Transform plain-language optimization questions into formal LP models,
                quantitative solutions, and executive-level explanations.
              </p>
            </div>

            <main className="chat-window">
              <div className="messages-list">
                {messages.map((message) => (
                  <ChatMessageBubble key={message.id} message={message} />
                ))}

                {loading ? (
                  <div className="message-row assistant-row">
                    <div className="avatar assistant-avatar">S</div>
                    <div className="message-bubble assistant-bubble thinking-bubble">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  </div>
                ) : null}

                <div ref={bottomRef} />
              </div>
            </main>

            <footer className="chat-footer">
              <ChatInput onSend={sendProblem} loading={loading} />
            </footer>
          </section>

          <aside className="insight-panel">
            <section className="insight-card">
              <h3>Live Operations</h3>
              <div className="metric-grid">
                <div className="metric-item">
                  <span>Messages</span>
                  <strong>{messages.length}</strong>
                </div>
                <div className="metric-item">
                  <span>Solved</span>
                  <strong>{solvedMessages}</strong>
                </div>
                <div className="metric-item">
                  <span>Errors</span>
                  <strong>{errorMessages}</strong>
                </div>
                <div className="metric-item">
                  <span>Backend</span>
                  <strong>{backendOnline ? "Online" : "Offline"}</strong>
                </div>
              </div>
            </section>

            <section className="insight-card">
              <h3>Prompting Pattern</h3>
              <p className="insight-text">
                Include objective, decision variables, and each constraint in separate clauses for
                more accurate parsing and cleaner explanations.
              </p>
              <div className="workflow-list">
                <span>1. Describe objective</span>
                <span>2. Add numeric constraints</span>
                <span>3. Define variable bounds</span>
              </div>
            </section>

            <section className="insight-card accent">
              <h3>Modeling Insight</h3>
              <p className="insight-text mono">
                max z = c1x1 + c2x2 + ...
                <br />
                Ax &lt;= b, x &gt;= 0
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
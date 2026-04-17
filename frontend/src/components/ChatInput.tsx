import { useRef, useState, type KeyboardEvent } from "react";

type ChatInputProps = {
  onSend: (value: string) => void;
  loading: boolean;
};

const EXAMPLES = [
  {
    label: "EN - Min",
    text: "Minimize Z = 3x + 2y subject to: x + y <= 10, x >= 0, y >= 0"
  },
  {
    label: "EN - Max",
    text: "Maximize Z = 5x1 + 4x2 subject to: 6x1 + 4x2 <= 24, x1 + 2x2 <= 6, x1 >= 0, x2 >= 0"
  },
  {
    label: "FR - Min",
    text: "Minimiser Z = 2x + 3y sous les contraintes: x + y >= 5, x + 2y >= 8, x >= 0, y >= 0"
  }
];

export function ChatInput({ onSend, loading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    if (!value.trim() || loading) {
      return;
    }

    onSend(value);
    setValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    const node = inputRef.current;
    if (!node) {
      return;
    }

    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }

  function loadExample(example: string) {
    setValue(example);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }

  return (
    <div className="chat-input-area">
      <div className="example-row">
        {EXAMPLES.map((sample) => (
          <button
            key={sample.label}
            className="example-chip"
            type="button"
            disabled={loading}
            onClick={() => loadExample(sample.text)}
          >
            {sample.label}
          </button>
        ))}
      </div>

      <div className="input-row">
        <textarea
          ref={inputRef}
          className="lp-textarea"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onInput={autoResize}
          placeholder="Example: Maximize profit with capacity and demand constraints..."
          rows={3}
          disabled={loading}
        />

        <button className="send-button" type="button" disabled={loading} onClick={handleSubmit}>
          {loading ? "Working..." : "Optimize"}
        </button>
      </div>

      <p className="input-hint">Use Ctrl+Enter or Cmd+Enter to submit</p>
    </div>
  );
}
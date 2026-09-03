import { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { sendWs, newMsgId, isConnected } from '../client/ws';
import { onMessage, onStatus } from '../client/dispatcher';
import './ChatPanel.css';

/* ═══════════════════════════════════════════════════════════════════
   ChatPanel — message display only.

   Receives messages from dispatcher (server responses).
   Receives user input from Orb (Tauri IPC).
   Sends user input to server via WS chat_send.
   ═══════════════════════════════════════════════════════════════════ */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

let _seq = 0;
function nextId(): string { return `msg-${Date.now()}-${++_seq}`; }

export function ChatPanel({ clearKey }: { clearKey?: number }) {
  const [messages, setMessages] = useState<Message[]>(() => [{
    id: nextId(), role: 'assistant',
    content: '你好，我是小助手，你的 AI 编程助手。有什么可以帮你的？',
    timestamp: Date.now(),
  }]);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  // ── auto-scroll ──────────────────────────────────────────────
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  // ── clear ────────────────────────────────────────────────────
  useEffect(() => {
    if (clearKey && clearKey > 0) setMessages([{
      id: nextId(), role: 'assistant',
      content: '对话已清空。有什么可以帮你的？', timestamp: Date.now(),
    }]);
  }, [clearKey]);

  // ── receive server messages via dispatcher ───────────────────
  useEffect(() => {
    const u1 = onMessage((msg) => {
      // 后端回复到达——关闭等待特效，新气泡显示内容（第一条就关，后续条继续显示）
      busyRef.current = false;
      setSending(false);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: msg.content, timestamp: Date.now() },
      ]);
    });

    const u2 = onStatus((text) => setStatus(text));

    return () => { u1(); u2(); };
  }, []);

  // ── receive user input from Orb ──────────────────────────────
  useEffect(() => {
    const ul = listen<{ text: string }>('orb:send-message', (e) => {
      const text = e.payload.text;
      if (!text) return;

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', content: text, timestamp: Date.now() },
      ]);

      if (!isConnected()) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: '⚠️ 未连接到 Server', timestamp: Date.now() },
        ]);
        return;
      }

      // 不在等待中才开启等待特效；多条消息不重复开启
      if (!busyRef.current) {
        busyRef.current = true;
        setSending(true);
      }

      const history = messages
        .filter((m) => m.role !== 'assistant' || !m.id.startsWith('s-'))
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: text });

      sendWs({
        msg_id: newMsgId(),
        type: 'chat_send',
        target: 'desktop',
        payload: { messages: history },
      });
    });

    return () => { ul.then((f: () => void) => f()); };
  }, [messages]);

  // ── render ───────────────────────────────────────────────────
  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={listRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role === 'user' ? 'chat-msg--user' : 'chat-msg--bot'}`}>
            {msg.role === 'assistant' && <span className="chat-msg__name">小助手</span>}
            <div className="chat-msg__bubble">
              {msg.content.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
            </div>
            <span className="chat-msg__time">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        {sending && (
          <div className="chat-msg chat-msg--bot">
            <span className="chat-msg__name">小助手</span>
            <div className="chat-msg__bubble chat-msg__bubble--typing">
              <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* ── status bar — bottom-left ──────────────────────────── */}
      {status && (
        <div style={{
          position: 'absolute', bottom: 28, left: 12,
          fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)', pointerEvents: 'none',
          maxWidth: 'calc(100% - 24px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {status}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  defaultSuggestions,
  getGraphDataset,
  initialMessages,
  legendItems,
  resolveMujiResponse,
  type GraphDataset,
  type KnowledgeMessage,
  type ProductCard,
} from "@/data/muji-demo";

type MobileTab = "chat" | "graph";
type GraphMode = {
  focusLabel: string | null;
};
type DragState = {
  lastX: number;
  lastY: number;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
  time: number;
};

type PendingReply = {
  question: string;
  startedAt: number;
};

const GRAPH_BOUNDS = {
  maxX: 70,
  minX: -70,
  maxY: 55,
  minY: -55,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyElasticBounds(value: number, min: number, max: number) {
  if (value < min) return min + (value - min) * 0.28;
  if (value > max) return max + (value - max) * 0.28;
  return value;
}

function lineMidpoint(x1: number, y1: number, x2: number, y2: number, offset = 0) {
  return {
    x: (x1 + x2) / 2 + offset,
    y: (y1 + y2) / 2 - 6,
  };
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentTimeMs() {
  return Date.now();
}

function ProductAnswerCard({
  card,
  confidence,
  onFocusGraph,
}: {
  card: ProductCard;
  confidence?: string;
  onFocusGraph: (focusLabel: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="product-card">
        <div className="product-card-header">
          {card.image ? <img className="product-card-img" src={card.image} alt={card.name} /> : null}
          <div className="product-card-info">
            <h4>{card.name}</h4>
            <div className="name-en">{card.englishName}</div>
            <div className="product-card-category">{card.category}</div>
          </div>
        </div>
        <div className="product-card-badges">
          {card.badges.map((badge) => (
            <span key={badge} className="badge">
              {badge}
            </span>
          ))}
        </div>
        <div className="product-card-specs">{card.specs}</div>
        <div className="product-card-talk">💬 {card.recommendation}</div>
        <div className="product-card-footer">
          <span className="product-card-price">{card.price}</span>
          <button
            type="button"
            className="muji-btn outline focus-btn"
            onClick={() => onFocusGraph(card.focusNodeLabel)}
          >
            ◉ {card.focusPrompt ?? "图谱"}
          </button>
        </div>
      </div>

      <div className={`retrieval-pipeline ${expanded ? "expanded" : "collapsed"}`}>
        <div className="pipeline-header">
          <div className="pipeline-title">🔍 检索决策链路</div>
          <div className="pipeline-controls">
            <span className="pipeline-mode-badge">{card.trace.mode}</span>
            <button type="button" className="pipeline-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "收起 ▾" : "展开 ▸"}
            </button>
          </div>
        </div>

        <div className="pipeline-body">
          <div className="fusion-results">
            <div className="fusion-results-title">📦 匹配商品</div>
            <div className="fusion-result-row">
              <div className="fusion-result-name">{card.trace.matchedProduct}</div>
              <div className="fusion-result-score">{card.category}</div>
            </div>
          </div>

          {expanded ? (
            <div className="pipeline-detail open">
              <div className="detail-section recall-context-section">
                <div className="detail-section-title">查询理解</div>
                <div className="detail-row">
                  <span className="detail-key">意图</span>
                  <span className="detail-val">{card.trace.intent}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">约束</span>
                  <span className="detail-val">{card.trace.constraints}</span>
                </div>
                <div className="term-chip-row">
                  <span className="term-chip">{card.trace.matchedProduct}</span>
                </div>
              </div>

              <div className="detail-section recall-context-section">
                <div className="detail-section-title">知识证据</div>
                <div className="evidence-product">
                  <div className="evidence-product-head">
                    <span className="evidence-product-name">{card.trace.matchedProduct}</span>
                    <span className="answerability-score">{card.trace.answerability}</span>
                  </div>
                  <div className="knowledge-evidence-row">
                    <span className="chunk-type">{card.trace.quoteLabel}</span>
                    <span className="chunk-text">{card.trace.quote}</span>
                  </div>
                  <div className="knowledge-evidence-row">
                    <span className="chunk-type">场景</span>
                    <span className="chunk-text">{card.trace.scenario}</span>
                  </div>
                  <div className="knowledge-evidence-row">
                    <span className="chunk-type">规格</span>
                    <span className="chunk-text">{card.specs}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">匹配依据</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {confidence ? (
        <div className="answer-meta">
          <span>置信度: {confidence}</span>
          <span>模式: {card.mode}</span>
        </div>
      ) : null}
    </>
  );
}

export function MujiKnowledgeBase() {
  const [activeTab, setActiveTab] = useState<MobileTab>("graph");
  const [graphMode, setGraphMode] = useState<GraphMode>({ focusLabel: null });
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<KnowledgeMessage[]>(initialMessages);
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 });
  const [graphScale, setGraphScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const velocityRef = useRef({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);

  const graphDataset: GraphDataset = useMemo(() => getGraphDataset(graphMode.focusLabel), [graphMode.focusLabel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingReply, thinkingSeconds]);

  useEffect(() => {
    function stopInertia() {
      if (inertiaFrameRef.current !== null) {
        window.cancelAnimationFrame(inertiaFrameRef.current);
        inertiaFrameRef.current = null;
      }
    }

    function animateInertia() {
      stopInertia();

      const step = () => {
        setGraphOffset((current) => {
          let nextX = current.x + velocityRef.current.x;
          let nextY = current.y + velocityRef.current.y;

          velocityRef.current.x *= 0.92;
          velocityRef.current.y *= 0.92;

          if (nextX < GRAPH_BOUNDS.minX || nextX > GRAPH_BOUNDS.maxX) {
            const targetX = clamp(nextX, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX);
            velocityRef.current.x += (targetX - nextX) * 0.14;
          }

          if (nextY < GRAPH_BOUNDS.minY || nextY > GRAPH_BOUNDS.maxY) {
            const targetY = clamp(nextY, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY);
            velocityRef.current.y += (targetY - nextY) * 0.14;
          }

          nextX += velocityRef.current.x;
          nextY += velocityRef.current.y;

          if (Math.abs(velocityRef.current.x) < 0.12 && Math.abs(velocityRef.current.y) < 0.12) {
            nextX = clamp(nextX, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX);
            nextY = clamp(nextY, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY);
            stopInertia();
          } else {
            inertiaFrameRef.current = window.requestAnimationFrame(step);
          }

          return { x: nextX, y: nextY };
        });
      };

      inertiaFrameRef.current = window.requestAnimationFrame(step);
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragRef.current) return;

      const now = performance.now();
      const deltaTime = Math.max(1, now - dragRef.current.time);
      const deltaX = event.clientX - dragRef.current.lastX;
      const deltaY = event.clientY - dragRef.current.lastY;

      velocityRef.current = {
        x: deltaX / (deltaTime / 16),
        y: deltaY / (deltaTime / 16),
      };

      dragRef.current.lastX = event.clientX;
      dragRef.current.lastY = event.clientY;
      dragRef.current.time = now;

      setGraphOffset({
        x: applyElasticBounds(
          dragRef.current.originX + event.clientX - dragRef.current.startX,
          GRAPH_BOUNDS.minX,
          GRAPH_BOUNDS.maxX
        ),
        y: applyElasticBounds(
          dragRef.current.originY + event.clientY - dragRef.current.startY,
          GRAPH_BOUNDS.minY,
          GRAPH_BOUNDS.maxY
        ),
      });
    }

    function handlePointerUp() {
      if (dragRef.current) animateInertia();
      dragRef.current = null;
      setIsDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      stopInertia();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (!pendingReply) return undefined;

    const tick = window.setInterval(() => {
      setThinkingSeconds(Math.max(0, Math.floor((Date.now() - pendingReply.startedAt) / 1000)));
    }, 200);

    const response = resolveMujiResponse(pendingReply.question);
    const messageId = makeId("bot");
    let streamInterval: number | null = null;

    const finishThinking = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          card: response.card,
          confidence: response.confidence,
          id: messageId,
          role: "bot",
          text: "",
        },
      ]);
      setStreamingMessageId(messageId);
      setPendingReply(null);
      setThinkingSeconds(0);

      let index = 0;
      const charsPerTick = 3;
      streamInterval = window.setInterval(() => {
        index = Math.min(index + charsPerTick, response.answer.length);
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, text: response.answer.slice(0, index) }
              : message
          )
        );

        if (index >= response.answer.length) {
          if (streamInterval !== null) window.clearInterval(streamInterval);
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    card: response.card,
                    confidence: response.confidence,
                    suggestions: response.suggestions ?? defaultSuggestions,
                    text: response.answer,
                  }
                : message
            )
          );
          if (response.focusNodeLabel) {
            setGraphMode({ focusLabel: response.focusNodeLabel });
          }
          setStreamingMessageId(null);
        }
      }, 35);
    }, 1600);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(finishThinking);
      if (streamInterval !== null) window.clearInterval(streamInterval);
    };
  }, [pendingReply]);

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (activeTab !== "graph") return;
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
    dragRef.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      originX: graphOffset.x,
      originY: graphOffset.y,
      startX: event.clientX,
      startY: event.clientY,
      time: performance.now(),
    };
    velocityRef.current = { x: 0, y: 0 };
    setIsDragging(true);
  }

  function resetGraph() {
    setGraphOffset({ x: 0, y: 0 });
    setGraphScale(1);
    setGraphMode({ focusLabel: null });
    setIsDragging(false);
    dragRef.current = null;
    velocityRef.current = { x: 0, y: 0 };
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }

  function zoomGraph(nextScale: number) {
    setGraphScale(clamp(nextScale, 0.85, 1.4));
  }

  function focusGraph(focusLabel: string) {
    setGraphMode({ focusLabel });
    setGraphOffset({ x: 0, y: 0 });
    setGraphScale(1);
    setActiveTab("graph");
  }

  function askQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pendingReply || streamingMessageId) return;

    setMessages((current) => [...current, { id: makeId("user"), role: "user", text: trimmed }]);
    setPendingReply({ question: trimmed, startedAt: currentTimeMs() });
    setInputValue("");
    setThinkingSeconds(0);
    setActiveTab("chat");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    askQuestion(inputValue);
  }

  return (
    <main className="muji-kb-shell">
      <section className="muji-kb">
        <nav className="tab-bar" aria-label="View switch">
          <button
            type="button"
            className={`tab-btn ${activeTab === "graph" ? "active" : ""}`}
            aria-pressed={activeTab === "graph"}
            onClick={() => setActiveTab("graph")}
          >
            <span className="tab-icon">◉</span>
            <span className="tab-label">图谱</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "chat" ? "active" : ""}`}
            aria-pressed={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
          >
            <span className="tab-icon">💬</span>
            <span className="tab-label">问答</span>
          </button>
        </nav>

        <section id="graph-panel" className={`panel ${activeTab === "graph" ? "is-active" : ""}`}>
          <div className="panel-header">
            <div className="graph-title-row">
              <h1>MUJI 商品知识图谱</h1>
              <span className="graph-mode-label">{graphDataset.modeLabel}</span>
            </div>
            <div className="legend-row">
              {legendItems.map((item) => (
                <span key={item.label} className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className={`panel-body graph-stage ${isDragging ? "dragging" : ""}`} onPointerDown={beginDrag} role="presentation">
            <div className="graph-toolbar">
              <button type="button" className="zoom-btn" onClick={() => zoomGraph(graphScale - 0.1)}>−</button>
              <span className="zoom-label">{Math.round(graphScale * 100)}%</span>
              <button type="button" className="zoom-btn" onClick={() => zoomGraph(graphScale + 0.1)}>+</button>
            </div>
            <div className="graph-viewport" style={{ transform: `translate(${graphOffset.x}px, ${graphOffset.y}px) scale(${graphScale})` }}>
              <svg id="graph-svg" className="graph-svg" viewBox={graphDataset.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="MUJI 商品知识图谱">
                <defs>
                  <marker id="arrowhead" viewBox="0 -5 10 10" refX="22" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,-4L8,0L0,4" fill="#c7c0b4" />
                  </marker>
                </defs>
                <g>
                  {graphDataset.lines.map((line, index) => {
                    const lineLabel = graphDataset.edgeLabels[index];
                    const labelPoint = lineMidpoint(line.x1, line.y1, line.x2, line.y2, index % 2 === 0 ? 0 : 2);
                    return (
                      <g key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}>
                        <line className="graph-link" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#d2cbc0" strokeDasharray={line.dashed ? "5 3" : undefined} markerEnd={line.dashed ? "url(#arrowhead)" : undefined} />
                        {lineLabel ? <text className="graph-link-label" x={labelPoint.x} y={labelPoint.y} fill="#8c857d">{lineLabel}</text> : null}
                      </g>
                    );
                  })}
                </g>
                <g>
                  {graphDataset.nodes.map((node) => (
                    <g key={node.label} className={`graph-node ${graphDataset.focusLabel === node.label ? "focused" : ""}`} transform={`translate(${node.x},${node.y})`}>
                      <circle r={graphDataset.focusLabel === node.label ? node.r + 2 : node.r} fill={node.fill} stroke="rgba(255,255,255,0.72)" strokeWidth={graphDataset.focusLabel === node.label ? 2.4 : 1.5} />
                      <text className={`graph-node-label ${node.persistent ? "persistent" : ""}`} dy={node.dy} dx={node.dx} textAnchor={node.anchor}>{node.label}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
          </div>

          <div className="panel-footer">
            <span>{graphDataset.summaryText}</span>
            <button type="button" className="muji-btn outline" onClick={resetGraph}>重置</button>
          </div>
        </section>

        <section id="chat-panel" className={`panel ${activeTab === "chat" ? "is-active" : ""}`}>
          <div className="scroll-container">
            {messages.map((message) => (
              <div key={message.id} className={`chat-msg ${message.role === "user" ? "user" : "bot"}`}>
                <div className="chat-bubble">
                  <div className="answer-text">{message.text}</div>
                  {message.note ? <div className="message-note">{message.note}</div> : null}
                </div>
                {message.role === "bot" && message.card ? <ProductAnswerCard card={message.card} confidence={message.confidence} onFocusGraph={focusGraph} /> : null}
                {message.role === "bot" && message.suggestions?.length ? (
                  <div className="suggest-chips">
                    {message.id === "welcome" ? <div className="suggest-label">💬 试试问：</div> : null}
                    {message.suggestions.map((suggestion) => (
                      <button key={`${message.id}-${suggestion}`} type="button" className="suggest-chip" onClick={() => askQuestion(suggestion)}>{suggestion}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {pendingReply ? (
              <div className="chat-msg bot thinking">
                <div className="chat-bubble thinking-bubble">
                  <div className="answer-text">思考中 {thinkingSeconds}秒</div>
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>

          <div className="suggested-questions" />

          <div className="chat-input-area">
            <form className="input-row" onSubmit={handleSubmit}>
              <input type="text" className="chat-input" placeholder="询问 MUJI 商品..." autoComplete="off" enterKeyHint="send" disabled={!!pendingReply || !!streamingMessageId} value={inputValue} onChange={(event) => setInputValue(event.target.value)} />
              <button type="submit" className="muji-btn" disabled={!!pendingReply || !!streamingMessageId}>发送</button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}

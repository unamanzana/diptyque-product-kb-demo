"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ExternalLink, Network, X } from "lucide-react";

import {
  defaultSuggestions,
  getFilterTrail,
  getGraphDataset,
  getProductCardsByNames,
  initialMessages,
  legendItems,
  resolveDiptyqueResponse,
  resolveGraphInteraction,
  type GraphDataset,
  type GraphLine,
  type GraphNode,
  type KnowledgeMessage,
  type ProductCard,
  type ResponseEntry,
} from "@/data/diptyque-demo";
import { isGiftRecommendationQuery } from "@/lib/diptyque-query-intent";

type MobileTab = "chat" | "graph";
type GraphMode = {
  filterNodeIds: string[];
  focusEdgeIds: string[];
  focusLabel: string | null;
  recommendationProductNames?: string[];
};
type PendingReply = {
  history: Array<{ role: "assistant" | "user"; content: string }>;
  question: string;
  startedAt: number;
};
type SimNode = GraphNode & {
  restX: number;
  restY: number;
  vx: number;
  vy: number;
};
type SimEdge = GraphLine & {
  restLength: number;
};
type DraggedNode = {
  id: string;
  moved: boolean;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  vx: number;
  vy: number;
  lastPointerX: number;
  lastPointerY: number;
  lastTime: number;
};

const VIEWBOX_PADDING = 28;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lineMidpoint(x1: number, y1: number, x2: number, y2: number, offset = 0) {
  return {
    x: (x1 + x2) / 2 + offset,
    y: (y1 + y2) / 2 - 6,
  };
}

function relationLayerText(value: string) {
  const labels: Record<string, string> = {
    fact: "事实关系",
    factual_compatibility: "兼容事实",
    recommendation: "推荐关系",
    derived_compatibility: "规格推导",
  };
  return labels[value] ?? value;
}

function relationProvenanceText(line: GraphLine) {
  if (line.reviewStatus === "derived_from_approved_rule") return "策展规则推导";
  if (line.reviewStatus === "derived_from_approved_spec") return "审核规格推导";
  if (line.reviewStatus === "approved" && line.evidenceType.includes("official_")) return "官方证据 + 人工审核";
  if (line.reviewStatus === "approved") return "人工审核关系";
  if (line.reviewStatus === "source_derived") return "原始字段推导";
  return relationLayerText(line.relationLayer);
}

function reviewStatusText(value: string) {
  const labels: Record<string, string> = {
    approved: "人工审核通过",
    source_derived: "原始字段推导",
    derived_from_approved_spec: "由已审核规格推导",
    derived_from_approved_rule: "由已审核推荐规则推导",
  };
  return labels[value] ?? value;
}

function evidenceTypeText(value: string) {
  const labels: Record<string, string> = {
    official_product_copy: "官方商品文案",
    official_product_identity: "官方商品信息",
    verified_collection: "已核验系列",
    source_field: "原始数据字段",
    curatorial_review: "人工策展审核",
    curatorial_rule: "人工策展规则",
  };
  return value
    .split("+")
    .map((item) => labels[item] ?? item)
    .join(" + ");
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentTimeMs() {
  return Date.now();
}

function recommendationThinkingStatus(seconds: number, question: string) {
  if (!isGiftRecommendationQuery(question)) return "正在检索图谱并组织答案";
  if (seconds < 4) return "正在理解送礼需求";
  if (seconds < 10) return "正在检索候选商品";
  if (seconds < 20) return "正在比较香调、品型与价格";
  return "正在生成逐款推荐依据";
}

function monotonicTimeMs() {
  return performance.now();
}

function nodeFloatSeed(nodeId: string) {
  let hash = 0;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(index)) % 9973;
  }
  return hash / 9973;
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
          {card.image ? (
            card.url ? (
              <a href={card.url} target="_blank" rel="noreferrer" title={"打开 " + card.name + " 官网商品页"}>
                <Image className="product-card-img" src={card.image} alt={card.name} width={72} height={72} />
              </a>
            ) : (
              <Image className="product-card-img" src={card.image} alt={card.name} width={72} height={72} />
            )
          ) : null}
          <div className="product-card-info">
            <h4>{card.url ? <a className="product-card-name-link" href={card.url} target="_blank" rel="noreferrer">{card.name}</a> : card.name}</h4>
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
          <div className="product-card-actions">
            {card.url ? (
              <a
                className="muji-btn outline focus-btn"
                href={card.url}
                target="_blank"
                rel="noreferrer"
                aria-label={"打开 " + card.name + " 官网商品页"}
              >
                <ExternalLink size={15} aria-hidden="true" />
                官网
              </a>
            ) : null}
            <button
              type="button"
              className="muji-btn outline focus-btn"
              onClick={() => onFocusGraph(card.focusNodeLabel)}
            >
              ◉ {card.focusPrompt ?? "图谱"}
            </button>
          </div>
        </div>
      </div>

      <div className={`retrieval-pipeline ${expanded ? "expanded" : "collapsed"}`}>
        <div className="pipeline-header">
          <div className="pipeline-title">🔍 检索决策链路</div>
          <div className="pipeline-controls">
            <span className="pipeline-mode-badge">{card.trace.mode}</span>
            <button type="button" className="pipeline-toggle" onClick={() => setExpanded((value) => !value)}>
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

function RecommendationProductCards({
  cards,
  onFocusGraph,
}: {
  cards: ProductCard[];
  onFocusGraph: (focusLabel: string) => void;
}) {
  return (
    <section className="recommendation-products" aria-label={`推荐商品 ${cards.length} 款`}>
      <div className="recommendation-products-header">
        <span>推荐商品</span>
        <span>{cards.length} 款</span>
      </div>
      <div className="recommendation-product-strip">
        {cards.map((card) => (
          <article key={card.focusNodeLabel} className="recommendation-product-card">
            <div className="recommendation-product-main">
              {card.url ? (
                <a href={card.url} target="_blank" rel="noreferrer" title={`打开 ${card.name} 商品页`}>
                  {card.image ? <Image className="recommendation-product-image" src={card.image} alt={card.name} width={62} height={62} /> : null}
                </a>
              ) : card.image ? (
                <Image className="recommendation-product-image" src={card.image} alt={card.name} width={62} height={62} />
              ) : null}
              <div className="recommendation-product-info">
                {card.url ? (
                  <a className="recommendation-product-name" href={card.url} target="_blank" rel="noreferrer">
                    {card.name}
                  </a>
                ) : (
                  <h4 className="recommendation-product-name">{card.name}</h4>
                )}
                <div className="recommendation-product-category">{card.category}</div>
                <div className="recommendation-product-specs">{card.specs}</div>
              </div>
            </div>
            <div className="recommendation-product-badges">
              {card.badges.slice(0, 3).map((badge) => (
                <span key={badge} className="badge">{badge}</span>
              ))}
            </div>
            <div className="recommendation-product-footer">
              <span className="product-card-price">{card.price}</span>
              <div className="recommendation-product-actions">
                {card.url ? (
                  <a
                    className="recommendation-icon-button"
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${card.name} 商品页`}
                    title="打开商品页"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                  </a>
                ) : null}
                <button
                  type="button"
                  className="recommendation-icon-button"
                  onClick={() => onFocusGraph(card.focusNodeLabel)}
                  aria-label={`查看 ${card.name} 单品图谱`}
                  title="查看单品图谱"
                >
                  <Network size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export function DiptyqueKnowledgeBase() {
  const [activeTab, setActiveTab] = useState<MobileTab>("graph");
  const [graphMode, setGraphMode] = useState<GraphMode>({ filterNodeIds: [], focusEdgeIds: [], focusLabel: null });
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<KnowledgeMessage[]>(initialMessages);
  const [graphScale, setGraphScale] = useState(1);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [renderNodes, setRenderNodes] = useState<GraphNode[]>([]);
  const [renderLines, setRenderLines] = useState<GraphLine[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphLine | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationFrameRef = useRef<number | null>(null);
  const lastSimulationTimeRef = useRef<number | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const simEdgesRef = useRef<SimEdge[]>([]);
  const draggedNodeRef = useRef<DraggedNode | null>(null);
  const suppressNodeClickRef = useRef(false);

  const graphDataset: GraphDataset = useMemo(
    () => getGraphDataset(graphMode.focusLabel, graphMode.filterNodeIds, graphMode.recommendationProductNames ?? []),
    [graphMode.filterNodeIds, graphMode.focusLabel, graphMode.recommendationProductNames]
  );
  const filterTrail = useMemo(() => getFilterTrail(graphMode.filterNodeIds), [graphMode.filterNodeIds]);
  const focusedEdgeIds = useMemo(() => new Set(graphMode.focusEdgeIds), [graphMode.focusEdgeIds]);
  const orderedRenderLines = useMemo(
    () => [...renderLines].sort((a, b) => Number(focusedEdgeIds.has(a.edgeId)) - Number(focusedEdgeIds.has(b.edgeId))),
    [focusedEdgeIds, renderLines]
  );
  const structuralCoreIds = useMemo(() => {
    const result = new Set<string>();
    if (graphDataset.modeLabel === "分类概览") {
      renderNodes
        .filter((node) => ["CoreFamily", "OntologyDomain"].includes(node.nodeType))
        .forEach((node) => result.add(node.id));
      return result;
    }

    const explicitCoreTypes = ["CoreFamily", "OntologyDomain", "ProductForm", "NoteFamily"];
    if (graphDataset.modeLabel === "推荐子图") explicitCoreTypes.push("Product");
    if (graphDataset.modeLabel.endsWith("本体")) {
      explicitCoreTypes.push("ScentConcept", "NoteIngredient", "ScentProfile", "ScentAccord");
    }
    renderNodes
      .filter((node) => explicitCoreTypes.includes(node.nodeType))
      .forEach((node) => result.add(node.id));
    renderLines.forEach((line) => result.add(line.sourceId));
    renderLines
      .filter((line) => focusedEdgeIds.has(line.edgeId))
      .forEach((line) => {
        result.add(line.sourceId);
        result.add(line.targetId);
      });
    graphMode.filterNodeIds.forEach((id) => result.add(id));
    if (graphDataset.focusLabel) result.add(graphDataset.focusLabel);
    return result;
  }, [focusedEdgeIds, graphDataset.focusLabel, graphDataset.modeLabel, graphMode.filterNodeIds, renderLines, renderNodes]);

  const hoveredHighlightIds = useMemo(() => {
    const result = new Set<string>();
    if (!hoveredNodeId) return result;

    const hoveredNode = renderNodes.find((node) => node.id === hoveredNodeId);
    if (!hoveredNode) return result;

    result.add(hoveredNodeId);
    const directLines = renderLines.filter((line) => line.sourceId === hoveredNodeId || line.targetId === hoveredNodeId);
    const directNeighborIds = Array.from(new Set(directLines.map((line) => (line.sourceId === hoveredNodeId ? line.targetId : line.sourceId))));
    const incomingProductIds = directNeighborIds.filter((id) => renderNodes.find((node) => node.id === id)?.nodeType === "Product");

    if (hoveredNode.nodeType === "Product") {
      directNeighborIds.forEach((id) => result.add(id));
      return result;
    }

    if (["CoreFamily", "ProductForm"].includes(hoveredNode.nodeType)) {
      incomingProductIds.forEach((productId) => {
        result.add(productId);
        renderLines.forEach((line) => {
          if (line.sourceId === productId) {
            result.add(line.targetId);
          }
        });
      });
      directNeighborIds.forEach((id) => result.add(id));
      return result;
    }

    directNeighborIds.forEach((id) => result.add(id));
    return result;
  }, [hoveredNodeId, renderLines, renderNodes]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingReply, thinkingSeconds]);

  function syncRenderFromSimulation() {
    const nextNodes = Array.from(simNodesRef.current.values()).map((node) => ({
      anchor: node.anchor,
      dx: node.dx,
      dy: node.dy,
      fill: node.fill,
      id: node.id,
      label: node.label,
      nodeType: node.nodeType,
      persistent: node.persistent,
      r: node.r,
      x: node.x,
      y: node.y,
    }));

    const positions = new Map(nextNodes.map((node) => [node.id, node]));
    const nextLines = simEdgesRef.current.map((edge) => {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      return {
        ...edge,
        x1: source?.x ?? edge.x1,
        x2: target?.x ?? edge.x2,
        y1: source?.y ?? edge.y1,
        y2: target?.y ?? edge.y2,
      };
    });

    setRenderNodes(nextNodes);
    setRenderLines(nextLines);
  }

  function stopSimulation() {
    if (simulationFrameRef.current !== null) {
      window.cancelAnimationFrame(simulationFrameRef.current);
      simulationFrameRef.current = null;
    }
    lastSimulationTimeRef.current = null;
  }

  function clampNodePosition(node: SimNode) {
    const viewBox = graphDataset.viewBox.split(" ").map(Number);
    const width = viewBox[2] || 640;
    const height = viewBox[3] || 596;
    node.x = clamp(node.x, VIEWBOX_PADDING, width - VIEWBOX_PADDING);
    node.y = clamp(node.y, VIEWBOX_PADDING, height - VIEWBOX_PADDING);
  }

  function runSimulationFrame(time: number) {
    const deltaMs = lastSimulationTimeRef.current == null ? 16 : Math.min(28, time - lastSimulationTimeRef.current);
    lastSimulationTimeRef.current = time;
    const dt = deltaMs / 16.6667;
    const timeSeconds = time / 1000;
    const nodes = Array.from(simNodesRef.current.values());
    const dragged = draggedNodeRef.current;
    const forces = new Map<string, { x: number; y: number }>();

    nodes.forEach((node) => {
      forces.set(node.id, { x: 0, y: 0 });
    });

    nodes.forEach((node) => {
      if (dragged?.id === node.id) return;
      const force = forces.get(node.id)!;
      const restSpring = 0.016;
      const seed = nodeFloatSeed(node.id);
      const driftXAmplitude = graphDataset.modeLabel === "分类概览" ? 5.2 : 3.6;
      const driftYAmplitude = graphDataset.modeLabel === "分类概览" ? 4 : 2.8;
      const driftX = Math.sin(timeSeconds * (0.28 + seed * 0.18) + seed * Math.PI * 2) * driftXAmplitude;
      const driftY = Math.cos(timeSeconds * (0.24 + seed * 0.16) + seed * Math.PI * 1.4) * driftYAmplitude;
      force.x += (node.restX + driftX - node.x) * restSpring;
      force.y += (node.restY + driftY - node.y) * restSpring;
    });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const desired = a.r + b.r + 28;
        if (distance >= desired) continue;
        const push = (desired - distance) * 0.018;
        const nx = dx / distance;
        const ny = dy / distance;
        const forceA = forces.get(a.id)!;
        const forceB = forces.get(b.id)!;
        forceA.x -= nx * push;
        forceA.y -= ny * push;
        forceB.x += nx * push;
        forceB.y += ny * push;
      }
    }

    simEdgesRef.current.forEach((edge) => {
      const source = simNodesRef.current.get(edge.sourceId);
      const target = simNodesRef.current.get(edge.targetId);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const delta = distance - edge.restLength;
      const spring = edge.dashed ? 0.012 : 0.018;
      const nx = dx / distance;
      const ny = dy / distance;
      const forceX = nx * delta * spring;
      const forceY = ny * delta * spring;
      if (dragged?.id !== source.id) {
        const force = forces.get(source.id)!;
        force.x += forceX;
        force.y += forceY;
      }
      if (dragged?.id !== target.id) {
        const force = forces.get(target.id)!;
        force.x -= forceX;
        force.y -= forceY;
      }
    });

    nodes.forEach((node) => {
      if (dragged?.id === node.id) {
        node.x = dragged.pointerX - dragged.offsetX;
        node.y = dragged.pointerY - dragged.offsetY;
        node.vx = dragged.vx;
        node.vy = dragged.vy;
        clampNodePosition(node);
        return;
      }

      const force = forces.get(node.id)!;
      node.vx += force.x * dt;
      node.vy += force.y * dt;
      node.vx *= 0.91;
      node.vy *= 0.91;
      node.x += node.vx * dt * 0.76;
      node.y += node.vy * dt * 0.76;
      clampNodePosition(node);
    });

    syncRenderFromSimulation();

    simulationFrameRef.current = window.requestAnimationFrame(runSimulationFrame);
  }

  function kickSimulation() {
    if (simulationFrameRef.current === null) {
      simulationFrameRef.current = window.requestAnimationFrame(runSimulationFrame);
    }
  }

  function pointerToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  const kickSimulationEffect = useEffectEvent(() => {
    kickSimulation();
  });

  useEffect(() => {
    const nextNodes = new Map<string, SimNode>();
    graphDataset.nodes.forEach((node) => {
      nextNodes.set(node.id, {
        ...node,
        restX: node.x,
        restY: node.y,
        vx: 0,
        vy: 0,
        x: node.x,
        y: node.y,
      });
    });
    simNodesRef.current = nextNodes;
    simEdgesRef.current = graphDataset.lines.map((line) => ({
      ...line,
      restLength: Math.hypot(line.x2 - line.x1, line.y2 - line.y1),
    }));
    syncRenderFromSimulation();
    kickSimulationEffect();
    return () => {
      draggedNodeRef.current = null;
      setDraggedNodeId(null);
    };
  }, [graphDataset]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragged = draggedNodeRef.current;
      if (!dragged) return;
      const nextPoint = pointerToSvg(event.clientX, event.clientY);
      if (!nextPoint) return;
      const now = performance.now();
      const deltaTime = Math.max(1, now - dragged.lastTime);
      const deltaX = nextPoint.x - dragged.lastPointerX;
      const deltaY = nextPoint.y - dragged.lastPointerY;
      dragged.pointerX = nextPoint.x;
      dragged.pointerY = nextPoint.y;
      dragged.vx = deltaX / (deltaTime / 16);
      dragged.vy = deltaY / (deltaTime / 16);
      dragged.moved = dragged.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2.2;
      dragged.lastPointerX = nextPoint.x;
      dragged.lastPointerY = nextPoint.y;
      dragged.lastTime = now;
      if (dragged.moved) suppressNodeClickRef.current = true;
      kickSimulationEffect();
    }

    function handlePointerUp() {
      const dragged = draggedNodeRef.current;
      if (!dragged) return;
      const node = simNodesRef.current.get(dragged.id);
      if (node) {
        node.vx = dragged.vx * 0.85;
        node.vy = dragged.vy * 0.85;
      }
      draggedNodeRef.current = null;
      setDraggedNodeId(null);
      kickSimulationEffect();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [graphScale]);

  function applyGraphMode(nextMode: GraphMode) {
    setGraphMode(nextMode);
    setGraphScale(1);
    setSelectedEdge(null);
    draggedNodeRef.current = null;
    setDraggedNodeId(null);
    suppressNodeClickRef.current = false;
    stopSimulation();
  }

  const applyGraphModeEffect = useEffectEvent((nextMode: GraphMode) => {
    applyGraphMode(nextMode);
  });

  function resetGraph() {
    applyGraphMode({ filterNodeIds: [], focusEdgeIds: [], focusLabel: null });
    setMessages((current) => [
      ...current,
      {
        id: makeId("bot"),
        note: "已清空图谱筛选",
        role: "bot",
        suggestions: defaultSuggestions,
        text: "已返回 Diptyque 分类概览。你可以重新从核心大类、品型、系列或标签继续探索。",
      },
    ]);
  }

  function zoomGraph(nextScale: number) {
    setGraphScale(clamp(nextScale, 0.88, 1.22));
  }

  function focusGraph(focusLabel: string) {
    applyGraphMode({ filterNodeIds: graphMode.filterNodeIds, focusEdgeIds: [], focusLabel });
    setActiveTab("graph");
  }

  function pushImmediateResponse(response: ResponseEntry, note?: string) {
    setMessages((current) => [
      ...current,
      {
        card: response.card,
        cards: response.cards,
        confidence: response.confidence,
        id: makeId("bot"),
        note,
        role: "bot",
        suggestions: response.suggestions ?? defaultSuggestions,
        text: response.answer,
      },
    ]);
  }

  useEffect(() => {
    if (!pendingReply) return undefined;

    const { history, question, startedAt } = pendingReply;
    const controller = new AbortController();
    let cancelled = false;
    let streamInterval: number | null = null;
    const tick = window.setInterval(() => {
      setThinkingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 200);
    const localResponse = resolveDiptyqueResponse(question);
    const messageId = makeId("bot");

    function streamResponse(response: ResponseEntry, note?: string) {
      setMessages((current) => [
        ...current,
        {
          card: response.card,
          cards: response.cards,
          confidence: response.confidence,
          id: messageId,
          note,
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
            message.id === messageId ? { ...message, text: response.answer.slice(0, index) } : message
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
                    cards: response.cards,
                    confidence: response.confidence,
                    note,
                    suggestions: response.suggestions ?? defaultSuggestions,
                    text: response.answer,
                  }
                : message
            )
          );
          applyGraphModeEffect({
            filterNodeIds: response.filterNodeIds ?? [],
            focusEdgeIds: response.focusEdgeIds ?? [],
            focusLabel: response.focusNodeLabel ?? null,
            recommendationProductNames: response.recommendationProductNames ?? [],
          });
          setStreamingMessageId(null);
        }
      }, 35);
    }

    async function answerQuestion() {
      let response = localResponse;
      let responseNote: string | undefined;
      try {
        const apiResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history, message: question }),
          signal: controller.signal,
        });
        if (!apiResponse.ok) throw new Error(`chat_http_${apiResponse.status}`);
        const data = (await apiResponse.json()) as {
          answer?: string;
          answerMode?: string;
          answerSource?: string;
          matchedProductNames?: string[];
          recommendedProductNames?: string[];
          model?: string;
          reasoningUsed?: boolean;
          fallback?: boolean;
        };
        if (data.answer?.trim()) {
          if (data.answerSource === "ontology_full_list") {
            response = {
              ...localResponse,
              answer: data.answer.trim(),
              card: undefined,
              focusEdgeIds: [],
              focusNodeLabel: localResponse.focusNodeLabel ?? "domain:香调",
            };
          } else if (
            data.answerSource === "deepseek_tools"
            || (data.answerSource === "local_fallback" && (data.recommendedProductNames?.length ?? 0) > 0)
          ) {
            const recommendationProductNames = data.recommendedProductNames ?? [];
            response = {
              ...localResponse,
              answer: data.answer.trim(),
              card: undefined,
              cards: getProductCardsByNames(
                recommendationProductNames,
                data.answerMode === "gift_recommendation" ? "送礼推荐" : "工具检索"
              ),
              filterNodeIds: [],
              focusEdgeIds: [],
              focusNodeLabel: undefined,
              recommendationProductNames,
            };
          } else {
            response = { ...localResponse, answer: data.answer.trim() };
          }
          responseNote = data.answerSource === "ontology_full_list"
            ? "本体全量检索 · " + (data.matchedProductNames?.length ?? 0) + "款"
            : data.answerSource === "deepseek_tools"
              ? (data.model ?? "DeepSeek") + " · 思考并检索 " + (data.matchedProductNames?.length ?? 0) + " 款"
              : data.answerSource === "local_fallback" && (data.recommendedProductNames?.length ?? 0) > 0
                ? "本地图谱兜底 · " + (data.matchedProductNames?.length ?? 0) + " 款"
                : data.model;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
      if (!cancelled) streamResponse(response, responseNote);
    }

    void answerQuestion();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(tick);
    };
  }, [pendingReply]);

  function handleGraphNodeSelect(nodeId: string) {
    if (pendingReply || streamingMessageId) return;
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    const interaction = resolveGraphInteraction(nodeId, graphMode.filterNodeIds);
    applyGraphMode({
      filterNodeIds: interaction.nextFilterNodeIds,
      focusEdgeIds: interaction.response.focusEdgeIds ?? [],
      focusLabel: interaction.nextFocusLabel,
    });
    pushImmediateResponse(interaction.response, "来自图谱点击");
  }

  function beginNodeDrag(nodeId: string, event: React.PointerEvent<SVGGElement>) {
    event.stopPropagation();
    const point = pointerToSvg(event.clientX, event.clientY);
    const node = simNodesRef.current.get(nodeId);
    if (!point || !node) return;
    draggedNodeRef.current = {
      id: nodeId,
      moved: false,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      pointerX: point.x,
      pointerY: point.y,
      vx: 0,
      vy: 0,
      lastPointerX: point.x,
      lastPointerY: point.y,
      lastTime: monotonicTimeMs(),
    };
    setDraggedNodeId(nodeId);
    suppressNodeClickRef.current = false;
    kickSimulation();
  }

  function askQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pendingReply || streamingMessageId) return;

    setMessages((current) => [...current, { id: makeId("user"), role: "user", text: trimmed }]);
    setPendingReply({
      history: messages
        .filter((message) => message.role === "user" || (message.role === "bot" && message.text.trim()))
        .slice(-8)
        .map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.text,
        })),
      question: trimmed,
      startedAt: currentTimeMs(),
    });
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
              <h1>Diptyque 商品知识图谱</h1>
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
            {filterTrail.length ? (
              <div className="graph-filter-bar" aria-label="当前筛选路径">
                <span className="graph-filter-title">当前筛选</span>
                {filterTrail.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="graph-filter-chip is-active"
                    onClick={() => handleGraphNodeSelect(item.id)}
                  >
                    <span>{item.label}</span>
                    <span className="graph-filter-chip-remove">×</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className={`panel-body graph-stage ${draggedNodeId ? "dragging" : ""}`} role="presentation">
            <div className="graph-toolbar">
              <button type="button" className="zoom-btn" onClick={() => zoomGraph(graphScale - 0.06)}>−</button>
              <span className="zoom-label">{Math.round(graphScale * 100)}%</span>
              <button type="button" className="zoom-btn" onClick={() => zoomGraph(graphScale + 0.06)}>+</button>
            </div>
            <div className="graph-viewport" style={{ transform: `scale(${graphScale})` }}>
              <svg ref={svgRef} id="graph-svg" className="graph-svg" viewBox={graphDataset.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Diptyque 商品知识图谱">
                <defs>
                  <marker id="arrowhead" viewBox="0 -5 10 10" refX="22" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,-4L8,0L0,4" fill="#c7c0b4" />
                  </marker>
                </defs>
                <g>
                  {orderedRenderLines.map((line, index) => {
                    const lineLabel = line.label || graphDataset.edgeLabels[index];
                    const labelPoint = lineMidpoint(line.x1, line.y1, line.x2, line.y2, index % 2 === 0 ? 0 : 2);
                    const isHoverLine = hoveredHighlightIds.has(line.sourceId) && hoveredHighlightIds.has(line.targetId);
                    const isProductRelation = line.relationLayer !== "fact" || ["REFILL_FOR", "ACCESSORY_FOR", "PAIRS_WITH", "LAYER_WITH", "EXTENDS_TO_HOME"].includes(line.edgeType);
                    const isAnswerEdge = focusedEdgeIds.has(line.edgeId);
                    const isDimmedEdge = focusedEdgeIds.size > 0 && !isAnswerEdge;
                    const isSelectedEdge = selectedEdge?.edgeId === line.edgeId;
                    return (
                      <g
                        key={line.edgeId}
                        className={"graph-edge " + (isSelectedEdge ? "selected-relation " : "") + (isAnswerEdge ? "answer-relation " : "") + (isDimmedEdge ? "dimmed-relation" : "")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedEdge(line);
                        }}
                      >
                        <line
                          className="graph-link-hit"
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          stroke="transparent"
                          strokeWidth={isAnswerEdge || isSelectedEdge ? 11 : 7}
                        />
                        <line
                          className="graph-link"
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          stroke={isSelectedEdge || isAnswerEdge ? "#7f0019" : "#d2cbc0"}
                          opacity={isSelectedEdge ? 0.96 : isAnswerEdge ? 0.86 : isDimmedEdge ? 0.08 : isHoverLine ? 0.82 : 0.24}
                          strokeDasharray={line.dashed ? "5 3" : undefined}
                          markerEnd={line.dashed ? "url(#arrowhead)" : undefined}
                        />
                        {lineLabel ? <text className={"graph-link-label " + (isProductRelation ? "product-relation-label" : "")} x={labelPoint.x} y={labelPoint.y} fill={isAnswerEdge || isSelectedEdge ? "#7f0019" : "#8c857d"} opacity={isSelectedEdge || isAnswerEdge ? 1 : isDimmedEdge ? 0 : isHoverLine || isProductRelation ? 0.9 : 0}>{lineLabel}</text> : null}
                      </g>
                    );
                  })}
                </g>
                <g>
                  {renderNodes.map((node) => {
                    const isSelectedFilter = graphMode.filterNodeIds.includes(node.id);
                    const isFocusedNode = graphDataset.focusLabel === node.id;
                    const isCoreNode = structuralCoreIds.has(node.id) || isSelectedFilter || isFocusedNode;
                    const isDraggingThisNode = draggedNodeId === node.id;
                    const isHoverHighlight = hoveredHighlightIds.has(node.id);
                    return (
                      <g
                        key={node.id}
                        className={`graph-node interactive ${isCoreNode ? "core-node" : "ambient-node"} ${isHoverHighlight ? "hover-highlight" : ""} ${isFocusedNode ? "focused" : ""} ${isSelectedFilter ? "selected-filter" : ""} ${isDraggingThisNode ? "dragging-node" : ""}`}
                        transform={`translate(${node.x},${node.y})`}
                        style={{ pointerEvents: "auto" }}
                        onPointerEnter={() => setHoveredNodeId(node.id)}
                        onPointerLeave={() => setHoveredNodeId((current: string | null) => (current === node.id ? null : current))}
                        onPointerDown={(event) => beginNodeDrag(node.id, event)}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleGraphNodeSelect(node.id);
                        }}
                      >
                        <title>{node.label}</title>
                        <circle r={node.r + 12} fill="transparent" />
                        <circle
                          r={graphDataset.focusLabel === node.id ? node.r + 2 : node.r}
                          fill={node.fill}
                          stroke="none"
                          strokeWidth={0}
                        />
                        <text className={`graph-node-label ${node.persistent ? "persistent" : ""}`} dy={node.dy} dx={node.dx} textAnchor={node.anchor}>
                          {node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            {selectedEdge ? (
              <aside className="relation-detail-panel" aria-live="polite">
                <header className="relation-detail-header">
                  <div>
                    <span className="relation-layer-label">{relationProvenanceText(selectedEdge)}</span>
                    <h2>{selectedEdge.label}</h2>
                  </div>
                  <button
                    type="button"
                    className="relation-detail-close"
                    aria-label="关闭关系详情"
                    title="关闭关系详情"
                    onClick={() => setSelectedEdge(null)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>

                <div className="relation-route">
                  <strong>{selectedEdge.sourceName}</strong>
                  <span>{selectedEdge.label}</span>
                  <strong>{selectedEdge.targetName}</strong>
                </div>

                <dl className="relation-meta-grid">
                  <div>
                    <dt>关系层</dt>
                    <dd>{relationLayerText(selectedEdge.relationLayer)}</dd>
                  </div>
                  <div>
                    <dt>场景</dt>
                    <dd>{selectedEdge.scenario || "未标注"}</dd>
                  </div>
                  <div>
                    <dt>证据类型</dt>
                    <dd>{evidenceTypeText(selectedEdge.evidenceType)}</dd>
                  </div>
                  <div>
                    <dt>置信度</dt>
                    <dd>{selectedEdge.confidence || "未标注"}</dd>
                  </div>
                  <div>
                    <dt>审核状态</dt>
                    <dd>{reviewStatusText(selectedEdge.reviewStatus)}</dd>
                  </div>
                </dl>

                {selectedEdge.evidenceText ? (
                  <div className="relation-evidence">
                    <span>关系依据</span>
                    <p>{selectedEdge.evidenceText}</p>
                  </div>
                ) : (
                  <div className="relation-evidence">
                    <span>来源字段</span>
                    <p>{selectedEdge.viaField || "图谱结构关系"}</p>
                  </div>
                )}

                {selectedEdge.evidenceUrl ? (
                  <a className="relation-source-link" href={selectedEdge.evidenceUrl} target="_blank" rel="noreferrer">
                    查看来源
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </aside>
            ) : null}
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
                {message.role === "bot" && message.cards?.length ? <RecommendationProductCards cards={message.cards} onFocusGraph={focusGraph} /> : null}
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
                  <div className="answer-text">{recommendationThinkingStatus(thinkingSeconds, pendingReply.question)} · {thinkingSeconds} 秒</div>
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>

          <div className="suggested-questions" />

          <div className="chat-input-area">
            <form className="input-row" onSubmit={handleSubmit}>
              <input
                type="text"
                className="chat-input"
                placeholder="询问 Diptyque 商品、系列或标签..."
                autoComplete="off"
                enterKeyHint="send"
                disabled={!!pendingReply || !!streamingMessageId}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
              />
              <button type="submit" className="muji-btn" disabled={!!pendingReply || !!streamingMessageId}>发送</button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}

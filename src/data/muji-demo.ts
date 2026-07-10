export type GraphLine = {
  dashed: boolean;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

export type GraphNode = {
  anchor: "end" | "start";
  dx: number;
  dy: number;
  fill: string;
  label: string;
  persistent: boolean;
  r: number;
  x: number;
  y: number;
};

export type ProductCard = {
  badges: string[];
  category: string;
  englishName: string;
  focusNodeLabel: string;
  focusPrompt?: string;
  image?: string;
  mode: string;
  name: string;
  price: string;
  recommendation: string;
  specs: string;
  title: string;
  trace: {
    answerability: string;
    constraints: string;
    intent: string;
    matchedProduct: string;
    mode: string;
    quote: string;
    quoteLabel: string;
    scenario: string;
  };
};

export type KnowledgeMessage = {
  card?: ProductCard;
  confidence?: string;
  id: string;
  note?: string;
  role: "bot" | "user";
  suggestions?: string[];
  text: string;
};

export type ResponseEntry = {
  answer: string;
  card?: ProductCard;
  confidence?: string;
  focusNodeLabel?: string;
  keywords: string[];
  suggestions?: string[];
};

export type GraphDataset = {
  edgeLabels: string[];
  focusLabel?: string;
  lines: GraphLine[];
  modeLabel: string;
  nodes: GraphNode[];
  summaryText: string;
  viewBox: string;
};

const edgeLabels = [
  "材质", "搭配", "场景", "保养", "搭配", "搭配", "场景", "保养", "搭配", "材质",
  "材质", "保养", "搭配", "需求", "保养", "搭配", "需求", "保养", "搭配", "材质",
  "保养", "保养", "搭配", "材质", "场景", "需求", "需求", "保养", "搭配", "材质",
  "场景", "需求", "需求", "功能", "保养", "保养", "搭配", "材质", "场景", "需求",
  "需求", "功能", "保养", "保养", "搭配", "搭配", "场景", "需求", "保养", "搭配",
  "搭配", "材质", "需求", "需求", "功能", "保养", "保养", "搭配", "搭配", "材质",
  "场景", "需求", "搭配", "搭配",
];

const lineTuples: Array<[number, number, number, number, boolean]> = [
  [370.54856311038674, 230.48105180584278, 312.52012227409455, 360.92836615787917, false],
  [370.54856311038674, 230.48105180584278, 390.1726005338426, 157.02644581750755, true],
  [195.02260249062184, 251.65151354265814, 116.35788678755439, 298.1453015688142, false],
  [195.02260249062184, 251.65151354265814, 229.29018299850298, 327.0931740140142, false],
  [195.02260249062184, 251.65151354265814, 163.61182667966622, 370.142542406763, true],
  [195.02260249062184, 251.65151354265814, 292.38565258461745, 178.26477399523517, true],
  [163.61182667966622, 370.142542406763, 116.35788678755439, 298.1453015688142, false],
  [163.61182667966622, 370.142542406763, 229.29018299850298, 327.0931740140142, false],
  [163.61182667966622, 370.142542406763, 195.02260249062184, 251.65151354265814, true],
  [390.1726005338426, 157.02644581750755, 324.16158748836176, 91.16229159959033, false],
  [390.1726005338426, 157.02644581750755, 480.9601632257325, 266.1159591016153, false],
  [390.1726005338426, 157.02644581750755, 311.48340282719863, 273.3331170403493, false],
  [390.1726005338426, 157.02644581750755, 370.54856311038674, 230.48105180584278, true],
  [135.2839713387077, 253.6615314843015, 217.73824792947812, 361.1211064958184, false],
  [135.2839713387077, 253.6615314843015, 67.58641855204175, 202.24864906332968, false],
  [135.2839713387077, 253.6615314843015, 133.10779155716716, 335.58789332797994, true],
  [133.10779155716716, 335.58789332797994, 217.73824792947812, 361.1211064958184, false],
  [133.10779155716716, 335.58789332797994, 311.48340282719863, 273.3331170403493, false],
  [133.10779155716716, 335.58789332797994, 135.2839713387077, 253.6615314843015, true],
  [292.38565258461745, 178.26477399523517, 324.16158748836176, 91.16229159959033, false],
  [292.38565258461745, 178.26477399523517, 452.59695088108055, 240.1567832584155, false],
  [292.38565258461745, 178.26477399523517, 311.48340282719863, 273.3331170403493, false],
  [292.38565258461745, 178.26477399523517, 195.02260249062184, 251.65151354265814, true],
  [346.8777178336281, 451.3803755407776, 312.52012227409455, 360.92836615787917, false],
  [272.6634697679617, 260.5002380002829, 386.3387573878365, 319.4726835360394, false],
  [272.6634697679617, 260.5002380002829, 370.5031307215518, 356.1652279131746, false],
  [272.6634697679617, 260.5002380002829, 217.73824792947812, 361.1211064958184, false],
  [272.6634697679617, 260.5002380002829, 430.9379014055591, 269.4902346085155, false],
  [272.6634697679617, 260.5002380002829, 135.2839713387077, 253.6615314843015, true],
  [453.4205711429756, 328.5747810772818, 480.9601632257325, 266.1159591016153, false],
  [453.4205711429756, 328.5747810772818, 386.3387573878365, 319.4726835360394, false],
  [453.4205711429756, 328.5747810772818, 401.1917670302674, 393.0306597282631, false],
  [453.4205711429756, 328.5747810772818, 370.5031307215518, 356.1652279131746, false],
  [453.4205711429756, 328.5747810772818, 406.50250594030325, 357.6017678749694, false],
  [453.4205711429756, 328.5747810772818, 452.59695088108055, 240.1567832584155, false],
  [453.4205711429756, 328.5747810772818, 311.48340282719863, 273.3331170403493, false],
  [453.4205711429756, 328.5747810772818, 472.0843966772263, 389.0584994634614, true],
  [372.9811153605084, 277.1655677751762, 480.9601632257325, 266.1159591016153, false],
  [372.9811153605084, 277.1655677751762, 386.3387573878365, 319.4726835360394, false],
  [372.9811153605084, 277.1655677751762, 401.1917670302674, 393.0306597282631, false],
  [372.9811153605084, 277.1655677751762, 370.5031307215518, 356.1652279131746, false],
  [372.9811153605084, 277.1655677751762, 406.50250594030325, 357.6017678749694, false],
  [372.9811153605084, 277.1655677751762, 452.59695088108055, 240.1567832584155, false],
  [372.9811153605084, 277.1655677751762, 430.9379014055591, 269.4902346085155, false],
  [372.9811153605084, 277.1655677751762, 472.0843966772263, 389.0584994634614, true],
  [372.9811153605084, 277.1655677751762, 453.4205711429756, 328.5747810772818, true],
  [498.2907063270441, 338.14115024307205, 386.3387573878365, 319.4726835360394, false],
  [498.2907063270441, 338.14115024307205, 370.5031307215518, 356.1652279131746, false],
  [498.2907063270441, 338.14115024307205, 430.9379014055591, 269.4902346085155, false],
  [498.2907063270441, 338.14115024307205, 472.0843966772263, 389.0584994634614, true],
  [498.2907063270441, 338.14115024307205, 364.28556623054834, 409.794491840751, true],
  [472.0843966772263, 389.0584994634614, 480.9601632257325, 266.1159591016153, false],
  [472.0843966772263, 389.0584994634614, 401.1917670302674, 393.0306597282631, false],
  [472.0843966772263, 389.0584994634614, 370.5031307215518, 356.1652279131746, false],
  [472.0843966772263, 389.0584994634614, 406.50250594030325, 357.6017678749694, false],
  [472.0843966772263, 389.0584994634614, 452.59695088108055, 240.1567832584155, false],
  [472.0843966772263, 389.0584994634614, 430.9379014055591, 269.4902346085155, false],
  [472.0843966772263, 389.0584994634614, 498.2907063270441, 338.14115024307205, true],
  [472.0843966772263, 389.0584994634614, 364.28556623054834, 409.794491840751, true],
  [364.28556623054834, 409.794491840751, 312.52012227409455, 360.92836615787917, false],
  [364.28556623054834, 409.794491840751, 386.3387573878365, 319.4726835360394, false],
  [364.28556623054834, 409.794491840751, 217.73824792947812, 361.1211064958184, false],
  [364.28556623054834, 409.794491840751, 498.2907063270441, 338.14115024307205, true],
  [364.28556623054834, 409.794491840751, 472.0843966772263, 389.0584994634614, true],
];

const nodeTuples: Array<[number, number, number, string, string, "end" | "start", number, boolean]> = [
  [370.54856311038674, 230.48105180584278, 14, "#7f0019", "聚丙烯收纳盒", "start", 18, false],
  [312.52012227409455, 360.92836615787917, 9, "#5b8c5a", "聚丙烯", "end", -13, false],
  [390.1726005338426, 157.02644581750755, 14, "#7f0019", "聚酯棉麻混软质收纳盒", "start", 18, true],
  [195.02260249062184, 251.65151354265814, 14, "#7f0019", "PET旅行分装瓶", "end", -18, true],
  [116.35788678755439, 298.1453015688142, 9, "#4a7c96", "日常护肤", "end", -13, false],
  [229.29018299850298, 327.0931740140142, 9, "#c25b7a", "用后盖紧", "end", -13, false],
  [163.61182667966622, 370.142542406763, 14, "#7f0019", "敏感肌化妆水", "end", -18, false],
  [292.38565258461745, 178.26477399523517, 14, "#7f0019", "聚酯旅行收纳包", "end", -18, true],
  [480.9601632257325, 266.1159591016153, 9, "#5b8c5a", "棉", "start", 13, false],
  [217.73824792947812, 361.1211064958184, 9, "#c17d3b", "耐用日常使用", "end", -13, false],
  [324.16158748836176, 91.16229159959033, 9, "#5b8c5a", "聚酯纤维", "start", 13, false],
  [311.48340282719863, 273.3331170403493, 9, "#c25b7a", "收纳前保持干燥", "end", -13, false],
  [135.2839713387077, 253.6615314843015, 14, "#7f0019", "白瓷碗", "end", -18, false],
  [67.58641855204175, 202.24864906332968, 9, "#c25b7a", "避免撞击", "end", -13, false],
  [133.10779155716716, 335.58789332797994, 14, "#7f0019", "不锈钢汤匙", "end", -18, false],
  [452.59695088108055, 240.1567832584155, 9, "#c25b7a", "建议手洗", "start", 13, false],
  [346.8777178336281, 451.3803755407776, 14, "#7f0019", "聚丙烯文件盒", "start", 18, false],
  [272.6634697679617, 260.5002380002829, 14, "#7f0019", "木制托盘", "end", -18, false],
  [386.3387573878365, 319.4726835360394, 9, "#4a7c96", "居家生活", "start", 13, false],
  [370.5031307215518, 356.1652279131746, 9, "#c17d3b", "自然材质感", "start", 13, false],
  [430.9379014055591, 269.4902346085155, 9, "#c25b7a", "避免长时间直射日…", "start", 13, false],
  [453.4205711429756, 328.5747810772818, 14, "#7f0019", "麻混室内拖鞋", "start", 18, true],
  [401.1917670302674, 393.0306597282631, 9, "#c17d3b", "舒适居家", "start", 13, false],
  [406.50250594030325, 357.6017678749694, 9, "#7b5ea7", "靠垫支撑", "start", 13, false],
  [472.0843966772263, 389.0584994634614, 14, "#7f0019", "麻靠垫套", "start", 18, true],
  [372.9811153605084, 277.1655677751762, 14, "#7f0019", "棉质床品套件", "start", 18, true],
  [498.2907063270441, 338.14115024307205, 14, "#7f0019", "木制开放式置物架", "start", 18, true],
  [364.28556623054834, 409.794491840751, 14, "#7f0019", "LED桌灯", "start", 18, true],
];

const baseGraph = {
  edgeLabels,
  lines: lineTuples.map(([x1, y1, x2, y2, dashed]) => ({ dashed, x1, x2, y1, y2 })) as GraphLine[],
  nodes: nodeTuples.map(([x, y, r, fill, label, anchor, dx, persistent]) => ({
    anchor,
    dx,
    dy: 4,
    fill,
    label,
    persistent,
    r,
    x,
    y,
  })) as GraphNode[],
  viewBox: "0 0 640 596",
};

const responseEntries: ResponseEntry[] = [
  {
    answer: "PET旅行分装瓶适合日常护肤和短途出行收纳，材质为 PET，使用后建议及时盖紧。",
    card: {
      badges: ["日常护肤", "PET材质", "旅行收纳", "care"],
      category: "Travel",
      englishName: "PET Travel Dispenser Bottle",
      focusNodeLabel: "PET旅行分装瓶",
      focusPrompt: "图谱",
      mode: "product_qa",
      name: "PET旅行分装瓶",
      price: "官网当前价格：￥12",
      recommendation: "可继续追问容量、适用液体和搭配收纳包。",
      specs: "用途: 日常护肤 · 提示: 用后盖紧",
      title: "PET旅行分装瓶适合日常护肤和短途出行收纳。",
      trace: {
        answerability: "回答力 3.18",
        constraints: "category: Travel · material: PET",
        intent: "价格查询",
        matchedProduct: "PET旅行分装瓶",
        mode: "product_qa",
        quote: "适合日常护肤场景，使用后建议及时盖紧。",
        quoteLabel: "提示",
        scenario: "适用场景: 日常护肤",
      },
    },
    confidence: "83% · 🟢 high",
    focusNodeLabel: "PET旅行分装瓶",
    keywords: ["PET旅行分装瓶", "分装瓶"],
    suggestions: ["PET旅行分装瓶可以装什么东西？", "敏感肌化妆水适合什么肤质？"],
  },
  {
    answer: "LED桌灯更适合卧室、书桌和轻量阅读场景，适合搭配自然材质感的居家陈列。",
    card: {
      badges: ["卧室/书桌", "轻量阅读", "home-lighting", "desk"],
      category: "Lighting",
      englishName: "LED Desk Lamp",
      focusNodeLabel: "LED桌灯",
      focusPrompt: "图谱",
      mode: "product_qa",
      name: "LED桌灯",
      price: "官网当前价格：￥149",
      recommendation: "先询问摆放空间与亮度需求，再推荐同系列收纳与灯具。",
      specs: "用途: 书桌照明 · 风格: 自然简约",
      title: "LED桌灯更适合卧室、书桌和轻量阅读场景。",
      trace: {
        answerability: "回答力 3.22",
        constraints: "category: Lighting · scene: desk",
        intent: "场景适配",
        matchedProduct: "LED桌灯",
        mode: "product_qa",
        quote: "更偏向卧室、书桌和轻量阅读场景。",
        quoteLabel: "卖点",
        scenario: "适用场景: 卧室/书桌",
      },
    },
    confidence: "82% · 🟢 high",
    focusNodeLabel: "LED桌灯",
    keywords: ["LED桌灯", "桌灯"],
    suggestions: ["LED桌灯适合放在哪里？", "木制托盘适合什么场景？"],
  },
  {
    answer: "木制托盘与居家生活、自然材质感和日常展示场景关联更强，适合客厅、餐桌和收纳展示。",
    card: {
      badges: ["居家生活", "自然材质感", "tray-display", "living-room"],
      category: "Living",
      englishName: "Wooden Tray",
      focusNodeLabel: "木制托盘",
      focusPrompt: "图谱",
      mode: "product_qa",
      name: "木制托盘",
      price: "官网当前价格：￥78",
      recommendation: "可继续追问搭配置物架、桌灯或卧室收纳用品。",
      specs: "用途: 桌面承托 · 风格: 木质自然",
      title: "木制托盘适合居家展示与餐桌承托场景。",
      trace: {
        answerability: "回答力 3.11",
        constraints: "category: Living · material: wood",
        intent: "场景适配",
        matchedProduct: "木制托盘",
        mode: "product_qa",
        quote: "居家生活与自然材质感关联较强。",
        quoteLabel: "卖点",
        scenario: "适用场景: 客厅/餐桌",
      },
    },
    confidence: "80% · 🟢 high",
    focusNodeLabel: "木制托盘",
    keywords: ["木制托盘"],
    suggestions: ["木制托盘适合什么场景？", "木制开放式置物架适合放在哪里？"],
  },
  {
    answer: "白瓷碗在图谱中主要关联材质与保养提示，核心信息是瓷质器皿要避免撞击。",
    card: {
      badges: ["瓷质器皿", "餐厨", "avoid-impact", "tableware"],
      category: "Kitchen",
      englishName: "White Porcelain Bowl",
      focusNodeLabel: "白瓷碗",
      focusPrompt: "图谱",
      mode: "product_qa",
      name: "白瓷碗",
      price: "官网当前价格：￥22",
      recommendation: "可继续追问容量、搭配餐具和日常保养方式。",
      specs: "材质: 瓷 · 提示: 避免撞击",
      title: "白瓷碗的核心信息是瓷质器皿与避免撞击。",
      trace: {
        answerability: "回答力 2.96",
        constraints: "category: Kitchen · material: porcelain",
        intent: "材质查询",
        matchedProduct: "白瓷碗",
        mode: "product_qa",
        quote: "避免撞击。",
        quoteLabel: "保养",
        scenario: "适用场景: 餐桌日常使用",
      },
    },
    confidence: "78% · 🟢 high",
    focusNodeLabel: "白瓷碗",
    keywords: ["白瓷碗"],
    suggestions: ["白瓷碗是什么材质？", "不锈钢汤匙建议怎么保养？"],
  },
  {
    answer: "敏感肌化妆水与日常护肤场景高度相关，演示知识库里更强调使用与保养提示而不是成分参数。",
    card: {
      badges: ["日常护肤", "敏感肌", "care", "bottle"],
      category: "Beauty",
      englishName: "Sensitive Skin Toner",
      focusNodeLabel: "敏感肌化妆水",
      focusPrompt: "图谱",
      mode: "product_qa",
      name: "敏感肌化妆水",
      price: "官网当前价格：￥88",
      recommendation: "可进一步按肤质、补水诉求和旅行分装需求继续追问。",
      specs: "用途: 日常护肤 · 提示: 用后盖紧",
      title: "敏感肌化妆水主要关联日常护肤和使用提示。",
      trace: {
        answerability: "回答力 3.05",
        constraints: "category: Beauty · scene: skincare",
        intent: "用途查询",
        matchedProduct: "敏感肌化妆水",
        mode: "product_qa",
        quote: "适合日常护肤场景。",
        quoteLabel: "用途",
        scenario: "适用场景: 日常护肤",
      },
    },
    confidence: "79% · 🟢 high",
    focusNodeLabel: "敏感肌化妆水",
    keywords: ["敏感肌化妆水", "化妆水"],
    suggestions: ["敏感肌化妆水适合什么肤质？", "PET旅行分装瓶可以装什么东西？"],
  },
  {
    answer: "这是一条演示回答，用来复刻原站的问答交互。当前界面重点在于双面板布局、结果卡片和图谱联动。",
    confidence: "76% · 🟢 high",
    keywords: [],
    suggestions: ["PET旅行分装瓶多少钱？", "木制托盘适合什么场景？", "LED桌灯适合放在哪里？"],
  },
];

export const legendItems = [
  { color: "#7f0019", label: "商品" },
  { color: "#5b8c5a", label: "材质" },
  { color: "#4a7c96", label: "场景" },
  { color: "#c17d3b", label: "用户需求" },
  { color: "#7b5ea7", label: "功能" },
  { color: "#c25b7a", label: "保养说明" },
] as const;

export const graphSummary = {
  totalEdges: 64,
  totalNodes: 154,
  visibleNodes: 28,
};

export const defaultSuggestions = [
  "PET旅行分装瓶多少钱？",
  "LED桌灯适合放在哪里？",
  "木制托盘适合什么场景？",
  "白瓷碗是什么材质？",
];

export const initialMessages: KnowledgeMessage[] = [
  {
    id: "welcome",
    note: "支持多轮上下文理解 + 智能反问澄清",
    role: "bot",
    suggestions: defaultSuggestions,
    text: "欢迎使用 MUJI 商品知识库！询问商品信息、价格、搭配推荐。",
  },
];

function pointKey(x: number, y: number) {
  return `${x.toFixed(3)}:${y.toFixed(3)}`;
}

const baseNodeMap = new Map(baseGraph.nodes.map((node) => [pointKey(node.x, node.y), node]));

function transformGraph(nodes: GraphNode[], lines: GraphLine[]) {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 72;
  const width = 640;
  const height = 596;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);

  const coordMap = new Map<string, { x: number; y: number }>();
  const transformedNodes = nodes.map((node) => {
    const x = (node.x - minX) * scale + padding;
    const y = (node.y - minY) * scale + padding;
    coordMap.set(pointKey(node.x, node.y), { x, y });
    return { ...node, x, y };
  });

  const transformedLines = lines.map((line) => {
    const p1 = coordMap.get(pointKey(line.x1, line.y1));
    const p2 = coordMap.get(pointKey(line.x2, line.y2));
    return {
      ...line,
      x1: p1?.x ?? line.x1,
      x2: p2?.x ?? line.x2,
      y1: p1?.y ?? line.y1,
      y2: p2?.y ?? line.y2,
    };
  });

  return { nodes: transformedNodes, lines: transformedLines };
}

function buildFocusGraph(focusLabel: string): GraphDataset {
  const focusNode = baseGraph.nodes.find((node) => node.label === focusLabel);
  if (!focusNode) {
    return getGraphDataset(null);
  }

  const visited = new Set<string>();
  const included = new Set<string>();
  const queue: Array<{ depth: number; key: string }> = [{ depth: 0, key: pointKey(focusNode.x, focusNode.y) }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.key)) continue;
    visited.add(current.key);
    included.add(current.key);

    if (current.depth >= 2 && included.size >= 8) continue;

    baseGraph.lines.forEach((line) => {
      const sourceKey = pointKey(line.x1, line.y1);
      const targetKey = pointKey(line.x2, line.y2);

      if (sourceKey === current.key && !visited.has(targetKey) && included.size < 12) {
        queue.push({ depth: current.depth + 1, key: targetKey });
      }

      if (targetKey === current.key && !visited.has(sourceKey) && included.size < 12) {
        queue.push({ depth: current.depth + 1, key: sourceKey });
      }
    });
  }

  const nodes = baseGraph.nodes.filter((node) => included.has(pointKey(node.x, node.y)));
  const linesWithLabels = baseGraph.lines
    .map((line, index) => ({ line, label: edgeLabels[index] }))
    .filter(({ line }) => included.has(pointKey(line.x1, line.y1)) && included.has(pointKey(line.x2, line.y2)));
  const transformed = transformGraph(nodes, linesWithLabels.map(({ line }) => line));

  return {
    edgeLabels: linesWithLabels.map(({ label }) => label),
    focusLabel,
    lines: transformed.lines,
    modeLabel: "商品聚焦",
    nodes: transformed.nodes,
    summaryText: `${transformed.nodes.length} 节点 · ${transformed.lines.length} 关系`,
    viewBox: baseGraph.viewBox,
  };
}

export function getGraphDataset(focusLabel: string | null): GraphDataset {
  if (!focusLabel) {
    return {
      edgeLabels,
      lines: baseGraph.lines,
      modeLabel: "热门概览",
      nodes: baseGraph.nodes,
      summaryText: `显示 ${graphSummary.visibleNodes}/${graphSummary.totalNodes} 节点 · ${graphSummary.totalEdges} 关系`,
      viewBox: baseGraph.viewBox,
    };
  }

  return buildFocusGraph(focusLabel);
}

export function resolveMujiResponse(input: string) {
  const normalized = input.trim().toLowerCase();

  for (const entry of responseEntries) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      return entry;
    }
  }

  return responseEntries.at(-1)!;
}

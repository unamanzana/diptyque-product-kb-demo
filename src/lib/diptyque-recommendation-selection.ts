export type RecommendationCandidate = {
  collections: string[];
  name: string;
  productForm: string;
};

function normalizeMentionText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,;；:：·\-—_|/（）()]/g, "");
}

function recommendationHeadlineText(answer: string) {
  const headlines = answer
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:#{1,6}\s*)?(?:\*\*)?\d{1,2}[.、.)）]\s*(.+)$/)?.[1] ?? "")
    .filter(Boolean)
    .map((headline) => headline.split(/\s*(?:——|—|｜|\||：|:)\s*/)[0].replace(/\*\*/g, "").trim())
    .filter(Boolean);
  return {
    exactNamesOnly: headlines.length > 0,
    text: headlines.length ? headlines.join("\n") : answer,
  };
}

function collectionFormPosition(answer: string, candidate: RecommendationCandidate) {
  const normalizedForm = normalizeMentionText(candidate.productForm);
  if (!normalizedForm) return -1;

  for (const collection of candidate.collections) {
    const normalizedCollection = normalizeMentionText(collection);
    if (!normalizedCollection) continue;
    let collectionIndex = answer.indexOf(normalizedCollection);
    while (collectionIndex >= 0) {
      const context = answer.slice(collectionIndex, collectionIndex + normalizedCollection.length + 24);
      if (context.includes(normalizedForm)) return collectionIndex;
      collectionIndex = answer.indexOf(normalizedCollection, collectionIndex + normalizedCollection.length);
    }
  }
  return -1;
}

export function selectMentionedProductNames(
  answer: string,
  candidates: RecommendationCandidate[],
  limit = 5
) {
  const recommendationText = recommendationHeadlineText(answer);
  const normalizedAnswer = normalizeMentionText(recommendationText.text);
  const rawMatches = candidates.map((candidate) => {
    const normalizedName = normalizeMentionText(candidate.name);
    const positions: number[] = [];
    let position = normalizedAnswer.indexOf(normalizedName);
    while (position >= 0) {
      positions.push(position);
      position = normalizedAnswer.indexOf(normalizedName, position + normalizedName.length);
    }
    return { candidate, normalizedName, positions };
  });

  const matches = rawMatches.map((match) => {
    const exactPosition = match.positions.find((position) =>
      !rawMatches.some(
        (other) =>
          other.normalizedName.length > match.normalizedName.length &&
          other.positions.some(
            (otherPosition) =>
              position >= otherPosition &&
              position + match.normalizedName.length <= otherPosition + other.normalizedName.length
          )
      )
    );
    const exact = exactPosition != null;
    return {
      candidate: match.candidate,
      exact,
      name: match.candidate.name,
      position: exact
        ? exactPosition
        : recommendationText.exactNamesOnly
          ? -1
          : collectionFormPosition(normalizedAnswer, match.candidate),
    };
  });
  const exactMatches = matches.filter((match) => match.exact);
  const selectedMatches = matches
    .filter((match) => {
      if (match.position < 0) return false;
      if (match.exact) return true;
      return !exactMatches.some(
        (exactMatch) =>
          exactMatch.candidate.productForm === match.candidate.productForm &&
          exactMatch.candidate.collections.some((collection) => match.candidate.collections.includes(collection))
      );
    })
    .sort(
      (a, b) =>
        a.position - b.position ||
        Number(b.exact) - Number(a.exact) ||
        b.name.length - a.name.length ||
        a.name.localeCompare(b.name, "zh-CN")
    );

  return Array.from(new Set(selectedMatches.map((match) => match.name))).slice(0, limit);
}
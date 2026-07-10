# MUJI Product KB Clone Notes

## Target
- URL: `https://muji-product-kb-demo.netlify.app/`
- Title: `MUJI 商品知识库`
- Form: single-page split knowledge-base UI, not a marketing landing page

## Topology
- Desktop: two 50/50 panels
- Left panel: graph view with title, legend, SVG graph, footer stats, reset action
- Right panel: chat view with welcome card, suggestion chips, message list, bottom input row
- Mobile: top tab bar switches between graph and chat panels

## Visual Tokens
- Background: `#f5f0e8`
- Surface: `#fafaf8`
- Border: `#e8e4dc`
- Primary red: `#7f0019`
- Body text: `#333333`
- Secondary text: `#888888`
- Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif`

## Behaviors
- Mobile tabs: `图谱` and `问答`; active tab uses red underline
- Suggestion chips inject questions into chat
- Graph footer reset clears selected node focus
- This clone adds node focus/highlight to make the static SVG graph feel interactive while preserving the original layout

## Assets
- Reference screenshots saved under `docs/design-references/muji-product-kb-demo/`
- Graph rebuilt from extracted SVG coordinates in `src/data/muji-demo.ts`

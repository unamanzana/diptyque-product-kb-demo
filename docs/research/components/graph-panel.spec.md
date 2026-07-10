# Graph Panel Specification

## Overview
- Target file: `src/components/muji-knowledge-base.tsx`
- Source: extracted from live SVG and computed CSS
- Interaction model: static graph with local node-focus enhancement

## Structure
- Header: title plus mode pill
- Legend row: 6 semantic categories
- Body: responsive SVG graph sized to panel bounds
- Footer: `显示 28/154 节点 · 64 关系` plus reset button

## Key Styles
- Header padding: `10px 16px 6px`
- Footer padding: `6px 16px`
- Footer font size: `11px`
- Graph panel background: `rgb(250, 250, 248)`
- Reset button border radius: `8px`
- Reset button padding: `10px 18px`

## Responsive Behavior
- Desktop: left half of viewport with right divider
- Mobile: full-width panel under 56px tab bar

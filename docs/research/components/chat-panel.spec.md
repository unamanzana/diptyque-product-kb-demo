# Chat Panel Specification

## Overview
- Target file: `src/components/muji-knowledge-base.tsx`
- Interaction model: click-driven suggested questions plus typed input

## Structure
- Scrollable message column
- Welcome answer bubble
- Suggestion chip rows
- Fixed bottom input area with rounded field and send button

## Key Styles
- Input border radius: `20px`
- Input height: `44px`
- Send button border radius: `20px`
- Suggestion chip border radius: `16px`
- Suggestion chip padding: `7px 12px`
- Suggestion chip font size: `12px`

## Responsive Behavior
- Desktop: right half of viewport, always visible
- Mobile: hidden until `问答` tab is active

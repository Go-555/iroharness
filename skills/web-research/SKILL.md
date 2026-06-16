---
name: web-research
description: Use when the user asks for current facts, market/news research, product or technical investigation, or asks to search the web or X.
kind: workflow
purpose: knowledge
shape: atomic
role: workflow
user-invocable: true
allowed-tools:
  - web_search
---

# Web Research

Use this skill when the user asks for information that may have changed, or explicitly asks to research, search the web, check latest information, compare options, or look at X.

## Process

1. Decide whether current information is needed. If yes, use web search.
2. For X-specific requests, search public web results with `site:x.com` or `site:twitter.com` unless a dedicated X API tool is available.
3. Prefer primary sources, official docs, company pages, standards, papers, and direct announcements.
4. Separate confirmed facts from inference.
5. Include source links in text outputs when facts depend on searched sources.

## Output

- Keep short spoken summaries for voice delivery.
- For Slack or text reports, include a concise conclusion first, then evidence and links.
- Do not claim an exhaustive X search unless a dedicated authenticated X search tool was used.

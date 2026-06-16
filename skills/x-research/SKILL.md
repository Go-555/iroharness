---
name: x-research
description: Use when the user asks to search X, Twitter, x.com, posts, tweets, or trends.
kind: workflow
purpose: knowledge
shape: atomic
role: workflow
user-invocable: true
allowed-tools:
  - xurl.search
  - xurl.read
  - xurl.user
  - web_search
---

# X Research

Use this skill when the user asks for information from X/Twitter.

## Tool Policy

- Prefer `xurl search` for X-native evidence when credentials and API access allow it.
- Use only read-only xurl operations by default: `search`, `read`, and `user`.
- Do not post, reply, like, repost, follow, or send DMs unless a separate explicit write-capability is implemented and confirmed.
- If xurl search fails because the X API app is unauthorized, say that X-native search is not available yet and use web search fallback only when useful.

## Output

- Separate X-native findings from general web-search fallback.
- Include post URLs or handles when available.
- For voice delivery, summarize the main finding naturally.

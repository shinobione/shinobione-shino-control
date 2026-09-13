# Targeted ChatGPT catch-up

CONTROL v0.9.15 keeps the normal current-conversation delta Collector and adds a lightweight catch-up path for historical project conversations.

While ChatGPT is open, the Collector reads project/conversation metadata in the authenticated page MAIN world, sends only identifiers/project metadata/update timestamps to CONTROL Core, and lets Core decide which conversations actually need refreshing. Full conversation data is fetched only for new conversations, conversations whose remote `updatedAt` is newer than CONTROL's source-native timestamp, or known conversations that do not yet have a trustworthy source-native baseline.

The refreshed conversations are fed through the normal `/api/ingest/chatgpt-delta` endpoint. The catch-up path does not own mapping, derivation, deduplication or dashboard state, and it does not navigate visibly through old conversations.

This relies on internal endpoints used by the ChatGPT web app, not a public API contract. If those endpoints change, normal event-driven collection of the currently rendered conversation remains independent.

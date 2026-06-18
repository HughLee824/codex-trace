# Context Usage Layout Design

## Goal

Make the context usage UI feel coordinated with the session detail page by moving it out of the hero summary and into the token usage area.

## Current Problem

The context card currently sits beside the hero activity stats. Its donut chart, centered layout, and taller card shape make it read as a separate widget, while the data itself belongs with token usage rather than session activity.

## Chosen Approach

Keep the hero focused on session identity and activity counts: messages, tools, and events. Render context usage at the top of the usage section as a compact horizontal meter, followed by the existing token breakdown cards.

## UI Details

- Remove the context donut from the hero.
- Add a `Context window` meter above the token cards.
- Show percent, used tokens, and context window limit in the meter.
- Use the same white card, hairline border, and 8px radius visual language as the usage cards.
- Use a horizontal blue progress bar instead of a circular chart.
- On small screens, stack meter text and progress bar vertically.

## Scope

This is a presentation-only change. It should not change token parsing, storage, API responses, or indexed data.

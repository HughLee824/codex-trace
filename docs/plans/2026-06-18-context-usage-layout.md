# Context Usage Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move current context usage from the session hero into the token usage section as a compact horizontal meter.

**Architecture:** Keep existing `/usage` API data and rendering flow. `renderSessionHero()` should only render activity stats, while `renderAgentUsage()` should render a context meter from `usage.current` before the existing total token cards.

**Tech Stack:** Vanilla JavaScript in `public/app.js`, CSS in `public/styles.css`, Node test runner in `tests/ui.test.ts`.

---

### Task 1: Update UI Expectations

**Files:**
- Modify: `tests/ui.test.ts`

**Step 1: Write the failing test**

Update the timeline usage test to expect `renderContextMeter`, `class="context-meter"`, and no donut/conic-gradient-specific rendering.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/ui.test.ts`

Expected: FAIL because production code still renders `renderContextDonut` and `.context-donut`.

### Task 2: Implement the Meter

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Step 1: Update markup**

Remove `usage.current` from `renderSessionHero()` calls. Replace `renderContextDonut()` with `renderContextMeter()` and call it from `renderAgentUsage(usage)` before `renderTokenBreakdown(usage.total)`.

**Step 2: Update CSS**

Remove donut-specific layout from the hero summary. Add `.context-meter` styles that match the existing usage cards and render a horizontal progress bar.

**Step 3: Run focused test**

Run: `npm test -- tests/ui.test.ts`

Expected: PASS.

### Task 3: Verify

**Files:**
- No additional changes expected.

**Step 1: Run full verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: TypeScript build completes with exit 0.

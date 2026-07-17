# Design QA

- Source visual truth path: `browser-comment://current-turn/1`
- Implementation full-view screenshot: `design-qa-implementation.png`
- Implementation focused screenshot: `design-qa-inactive-device.png`
- Viewport: 718 × 969 CSS pixels
- State: REDMI Buds is the active input/output; Redmi speaker is inactive and expanded

## Full-view comparison evidence

The source annotation showed that the inactive Redmi speaker card still exposed output and input metric groups, including 44.1 kHz and two channels. The revised full view preserves the page structure, device order, card styling, controls, typography, colors, and responsive behavior while replacing the inactive badge with “活动参数未刷新”.

## Focused region comparison evidence

The focused implementation capture confirms that the inactive card no longer renders either the output or input metric group. Its expanded region contains only a neutral dashed status panel explaining that current input/output parameters are not refreshed or shown until the device becomes the default output.

## Findings

- No remaining P0, P1, or P2 differences for the requested annotation.
- Typography uses the existing system font stack and preserves the established hierarchy.
- Spacing and layout rhythm remain aligned with the existing card design; the inactive card is shorter because stale metrics were intentionally removed.
- Colors and visual tokens reuse the existing neutral inactive palette and dashed-border treatment.
- No image assets were added or changed; existing icon rendering is preserved.
- Copy clearly distinguishes unavailable active parameters from current measurements.

## Comparison history

1. Earlier P1 issue: an inactive device displayed standby input/output values as though they were current measurements.
2. Fix: hide metric groups for non-default output devices, change the badge to “活动参数未刷新”, and add a concise empty-state explanation.
3. Post-fix evidence: `design-qa-inactive-device.png` shows no sampling-rate or channel cards in the expanded inactive device.

## Primary interactions tested

- Initial device loading completed.
- Inactive device card expanded successfully.
- Active device still displays its mode badge.
- No browser console errors or warnings were present.

## Follow-up polish

- None required for this scoped annotation.

final result: passed

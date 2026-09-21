# Issue 2 review record

Reviews include the authorized Shop all correction. Base for all rounds: `f3f44ced689fd155ed1c731db8ebe1b12749b086` (main). Each pinned diff was nonempty. Reviewers were read-only and received no earlier findings for their first independent review.

## Round 1 — HEAD 82691ab914fa6036db43a79892f60d605c60252e

### Standards — gpt-5.6-luna

0 findings; worst severity: none. No hard violations or actionable smell concerns. Module-level components/catalogs, derived display state and symmetric controller/navigation cleanup follow AGENTS.md. The full code-review skill baseline was included.

### Spec — gpt-5.6-terra

0 findings; worst severity: none. Numeric routes, separate SKU/UUID identities, independently loaded product data, fixed-material colors, A2UI configuration, quantity validation and disabled commerce match issue 2, AC-02 and configuration-only AC-03. Shop all bypasses missing/ambiguous named mappings. At review time deployed verification was still pending; it subsequently succeeded as recorded in issue-2-evidence.md.

### Adversarial — gpt-5.6-sol

1 finding, P2: App.tsx configuration state and product.ts derived color validation retain an unavailable UUID invisibly. It can become selected again if a later entry returns that UUID.

### Local Qwen — qwen3.5:latest

Installed tag rechecked. Full diff: 51,548 bytes; completed CLI review consumed 15,092 input tokens, within the runtime's verified 32,768-token context. All changed files were included in one bounded group. First thinking-mode attempt looped and was interrupted; the same pinned review completed with `--think=false --nowordwrap --verbose`. This is one review round, not a new code revision.

Qwen's final report claimed missing HTTP-200 schema-refinement tests and questioned whether configurations should persist during navigation. It also discussed empty colors, native modifiers and API error handling without identifying a concrete failure.

### Finding dispositions

| ID | Reviewer | Severity | Location at reviewed HEAD | Verdict and evidence |
| --- | --- | --- | --- | --- |
| R1-A1 | adversarial | P2 | App.tsx:57; product.ts:110,133 | Confirmed and repaired. Successful availability revalidation now clears the stored UUID, retains quantity and an explicit unavailable flag, and requires an explicit color action to clear the warning. Regression visits another product, removes the UUID, returns, restores it upstream, then returns again and verifies it stays unselected. |
| R1-Q1 | Qwen | Minor/test gap | test/product.test.tsx (approximate line 75 supplied) | Invalid. The reviewed commit already has HTTP-200 wrong-material, unavailable, duplicate-ID, invalid-ID, schema and wrong-product-ID tests, including retries. |
| R1-Q2 | Qwen | Claimed critical, later retracted as ambiguity | App.tsx configuration state | Invalid. Requirement explicitly preserves configurations across in-tab navigation and resets on browser reload. React state survives rerenders; both RTL history/remount tests and the real production browser reload/history check pass. |
| R1-Q3 | Qwen | Unspecified | catalog.tsx ColorOption mapping | No actionable defect alleged. A placeholder with zero available options is the required empty state; no color is substituted. |

No confirmed P3-or-lower findings; no GitHub bugs filed for unsupported claims.

## Round 2

Pending pin and review of the unavailable-color repair and full updated diff.

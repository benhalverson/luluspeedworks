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
| R1-Q4 | Supplemental bounded Qwen retry | Claimed critical, repeated duplicates | catalog.tsx (approximate line 267 supplied) | Invalid and deduplicated. It claimed disabled Add to bag violates requirements, but this task explicitly requires it disabled. This supplemental API attempt hit its 1,500-output-token bound; the completed CLI report above remains the round's review. |

No confirmed P3-or-lower reviewer findings; no GitHub bugs filed for unsupported claims. A separately reproduced P3 browser asset issue is logged below.

## Round 2 — HEAD da1304b407a43d1aa55dc23217e7df8528bf4bb6

### Standards — gpt-5.6-luna

0 findings; worst severity: none. The verified response clears a remembered UUID only when it is absent, preserves quantity, avoids unnecessary state changes, and follows the typed-state/derived-display conventions and full smell baseline.

### Spec — gpt-5.6-terra

0 findings; worst severity: none. The P2 repair prevents a later upstream restoration from silently selecting the invalidated UUID. The full diff satisfies issue 2, AC-02 and configuration-only AC-03; deployed contract evidence is now present. No scope creep.

### Adversarial — gpt-5.6-sol

0 findings; worst severity: none. Verified the prior P2 repaired and regression covers removal, upstream restoration and revisit. Full diff rechecked for identity, fixed material, drafts, history/reload, cancellation, malformed responses and Shop all; no remaining reproducible defect found.

### Local Qwen — qwen3.5:latest

Installed tag rechecked. Entire 59,518-byte diff supplied in one group within the verified 32,768-token runtime context; no files dropped. CLI completed with `--think=false --nowordwrap --hidethinking`; requirements and unchanged request-helper/query-key context were supplied explicitly.

Three allegations, all independently rejected:

| ID | Claimed severity | Location supplied | Verdict and evidence |
| --- | --- | --- | --- |
| R2-Q1 | P3 | test/product.test.tsx:407–428 approximate | Invalid test-gap claim. The first detail integration test supplies an absolute primary image and gallery URL, resolves both through actual A2UI, and triggers the primary-image error to verify fallback. No functional defect established; Qwen itself says no actionable fix required. |
| R2-Q2 | P1 | test/product.test.tsx:375–406 approximate | Invalid. Disabled Add to bag is asserted in detail, catalog and scaffold tests, and all production viewport checks. The component hardcodes disabled as required. Repeating the assertion for every possible product is not a missing runtime behavior. |
| R2-Q3 | P2 | catalog.tsx:485–517 approximate | Invalid. The unavailable flag is converted into visible colorStatus text by detailView; the actual UI regression asserts the warning across revisits. Quantity inventory/stock counts are not supplied by this contract or required by configuration-only AC-03. No cart implementation is authorized. |

## Final disposition

Two rounds used, no third/fourth round. One confirmed P2 fixed and independently re-reviewed; zero unresolved implementation P0–P2 findings. No runtime changes after the reviewed repair; subsequent changes only record evidence and dispositions.

Separately confirmed P3 during production smoke: deployed gallery JPEG URLs advertise model/stl and Chromium blocks supplied images. Existing issues were checked for duplicates; [bug #16](https://github.com/benhalverson/luluspeedworks/issues/16) records reproduction, impact, headers, affected URLs and the unverified cause of the additional primary-image failure. Left open for separately scoped API/content work. Frontend fallback verified; successful external image loading is not claimed.

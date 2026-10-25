Read CLAUDE.md first and follow it. This is Phase 5: merge, integrate, and get a working deployment.
Runs LOCALLY. Phase 3b is committed on main. Phase 4 (UI) is on branch claude/phase-4-ui-mvk98m (PR #1).

## 1. Merge
- `git fetch origin` and merge origin/claude/phase-4-ui-mvk98m into main locally.
- Resolve conflicts by keeping BOTH sides' intent (likely: package.json, package-lock.json, tsconfigs,
  vercel.json). For package-lock.json: take main's version, then run `npm install` to regenerate.
- Run type check, build, tests, lint. Fix anything the merge broke.

## 2. Wire the UI to the real API
- Compare src/ui/pipeline.ts with the actual request/response shapes in api/extract.ts and
  api/daily-report.ts. Fix pipeline.ts to match the API (don't change the API or the contract).
- Confirm the UI shows the real run: data/demo/run-2015-01-13.json has is_sample: false, so the
  "SAMPLE" badge must not appear.

## 3. Competition rule check (no AI-generated image assets)
- grep src/ and index.html for "<svg" and any image files. Charts rendered by Recharts and
  lucide-react icons are allowed. Any other SVG drawing, logo, or decorative shape written in code must
  be removed and replaced with CSS or a lucide icon. Leave the favicon <link> in index.html alone —
  Malek is replacing it by hand.
- List what you found and what you removed.

## 4. Daily report tweak
- In the agent: decisions_for_earth has at most 3 items, and only decisions that need Earth's authority
  or affect crew safety, water, power, or mission schedule. Minor logistics go in crew_actions instead.
  Enforce the max in the zod schema too.
- Regenerate the replay: `npm run daily-report -- crew-147 --as-of 2015-01-13`. Confirm 0 ungrounded
  numbers and show the new report.

## 5. Local end-to-end test with the real API
- If the Vercel CLI is installed and linked, run `vercel dev` and test LIVE mode with the two Jan 13
  files (extract → daily report). If it isn't, tell me the exact commands to set it up and stop this
  step there.

## 6. Deployment readiness
- Make the project build the way Vercel will: run `npm run build` from a clean state and check that the
  api/ functions compile on Vercel. Known risks from Phase 3b: `.ts` extensions in imports and root
  tsconfig project references (which Vercel's docs say it doesn't support for functions). Fix these
  so a Vercel deploy works, without breaking local scripts.
- Tell me exactly how to deploy (dashboard import from GitHub, or `vercel --prod`) and which env vars
  must exist (GEMINI_API_KEY, GEMINI_MODEL).

## 7. Docs
- Merge docs/ai-log-phase-4.md into the README's AI-assisted code section, then delete the docs file.
- Rewrite Current state in CLAUDE.md for the merged project.

## Done when
- main contains both phases, all checks pass, replay works with the real run, the rule check is clean,
  and I have deploy instructions. Show me a short summary. Don't push — I'll review and push.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All incident data and analysis flow through `src/lib/data-source.ts`; UI never imports sample data directly — keeps the engine swappable (built-in TS vs external Python API).
- `src/lib/analysis/engine.ts` stays pure (Incident in, AnalysisResult out) and never sets confirmed causes — only humans confirm.
- Shared data shapes live in `src/lib/analysis/types.ts` — the contract for external engines.

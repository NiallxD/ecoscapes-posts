# cycle/ -- EcoScapes Goals, `/ecoscapes/`

What EcoScapes is doing (four goals and their targets), how (the maps and
tools that drive action), and how it fits the bigger picture (Canada 2030,
the KMGBF, the SDGs). Not linked from anywhere yet, and kept out of search
engines. A computer or tablet only for now; a phone gets the gate
(`shared/components/PhoneGate.astro`). The folder keeps its old name from the
six-step cycle it replaced.

| Where | What |
| --- | --- |
| `content/frameworks.json` | The four goals (ES.1–ES.4): name, statement, colour, an optional note. The KMGBF goals' wording, the SDGs, the poster's two-score key, and the draft tag (`"draft": ""` takes it away). |
| `content/targets.json` | Every target: its goal, words, what drives action on it (`actions`: maps and tools, in order), and the bigger picture in three `levels` (global, national, regional). `"supplementary": true` and no goal for 40 years of change. |
| `content/maps.json` | Every map, defined once and listed by each target it serves: a Data Sandbox model (below), or `"updating": true`. |
| `content/tools.json` | Guides, courses, agreements and sites: name, a line, and a link (a full address, or a path on this site) where there is one. A document with a `cover` (a picture in `content/docs/`) and a `title` is shown in place of a map, stacked with the goal's other documents, to open. |
| `CyclePage.astro` | The page. |
| `lib/content.ts` | Reads and checks the content at build: a misnamed goal, target, map, tool, SDG or layer stops the build with what to fix. |
| `lib/path.ts` | Where you are and how ↑ ↓ move you, and the `?goal=&target=&tab=&map=` address. No drawing, so a phone layout can use it too. |
| `lib/wheel.ts` | The disc, the ring of goals, and the targets on it. |
| `lib/recipe.ts` | A map as a Data Sandbox model: drawn by the Sandbox's own scoring, and the same model in the "Test it in the Sandbox" link. |

Worked out from the content, not written in it: where two targets meet (the
same Canada target under two goals), and which other targets a map serves.

## A map

```json
"refugia": {
  "title": "Micro-refugia × Macro-refugia",
  "about": "What the colours mean, in a sentence or two.",
  "source": "Climate Micro- and Macrorefugia (J. Stolar, 2026)",
  "version": "September 2026",
  "axes": ["Micro-refugia", "Macro-refugia"],
  "layers": [
    { "id": "climate-microrefugia", "axis": 0 },
    { "id": "climate-macrorefugia", "axis": 1 }
  ]
}
```

- Layer ids are from `dst/content/dst-layers.json`.
- Two scores: `axes` (across, then up), and each layer's `axis`. Drawn in the
  poster's key.
- One score: no `axes`; a `palette` (a Sandbox palette id) and `ends` (the
  key's two labels) instead.
- Each layer starts where the Sandbox would start it. `q` (shares of its area)
  or `bad` and `good` (in its own units) start it elsewhere; `higher` says
  which way is better, and `weight` how much it counts.

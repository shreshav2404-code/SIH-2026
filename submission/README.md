# Submission documents — SIH 2026 (SIH26024)

Team NeuraForge · Presidency University Bengaluru
Problem statement: AI-based compliance monitoring for Coal India.

| File | What it is |
|---|---|
| `NeuraForge_SIH26024_Idea_Submission.pptx` / `.pdf` | The pitch deck as submitted |
| `NeuraForge_SIH26024_Presentation_Crib.pdf` | Speaking notes for the pitch |
| `NeuraForge_SIH26024_Prototype_Build_Plan.pdf` | The 36-hour build plan |
| `NeuraForge_SIH26024_Domain_Research.docx` | Statutory and domain research |
| `NeuraForge_SIH26024_Pitch_Notes.docx` | Working notes |
| `SIH2026-IDEA-Presentation-Format.pptx` | The organisers' template |
| `ANUPALAN-deck-update.pdf` | **Change catalogue** — what the running system does now that the deck predates, tagged by slide |
| `deck-update.html` | Source of the catalogue above; open in a browser and print to PDF to regenerate |
| `wireframes/` | Early dashboard and field-app wireframes |

## Read the change catalogue first

The deck was written before the prototype was built, and several claims in it
are now either understated or wrong — the runtime changed from LiteRT-LM to
llama.cpp, and the hash-chain claim was only made literally true late in the
build. `ANUPALAN-deck-update.pdf` lists every delta with a tag saying whether
the slide gains a claim, keeps one with a better number, or must be corrected.
Every figure in it was measured on the running system rather than estimated.

## A note on imagery

Photographs in `web/src/assets/photos/` and the mobile bundle:

- **`field-*.jpg`** — Pexels (17971746), Pexels licence, free for commercial use
- **`excavator-*.jpg`** — Pixabay (2781679), Pixabay licence, free for commercial use
- **`underground-wide.jpg`, `rails-wide.jpg`, `seam-wide.jpg`** — supplied by the
  team. No watermark and no third-party logo, but the origin is unconfirmed.
  **Replace these with Pexels or Unsplash equivalents before any public
  release or publication.**

Several images that were considered are deliberately absent from this
repository: material still carrying a Chegg logo, a Shutterstock identifier or
a Freepik watermark, and the Government of India / Ministry of Coal emblem.
The emblem in particular is restricted by the **State Emblem of India
(Prohibition of Improper Use) Act, 2005** — a student prototype carrying it
asserts an authority the project does not have. Do not add it to the deck.

The India coalfield map in the dashboard is drawn from coordinates rather than
copied from a graphic, for the same reason: facts cannot be owned, so the map
is ours to ship.

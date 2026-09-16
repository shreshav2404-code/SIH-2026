# Statutory sources for the on-device model

Every example built by `tools/build_statute_dataset.py` comes from one of the
documents below. All are official, public Government of India texts,
downloaded from the Directorate General of Mines Safety on **2026-09-16**.
The files themselves are git-ignored; download them again into
`data/sources/` and check the SHA-256 prefix to be sure you have the same text.

## Current law: used for training

| File | What it is | Size | SHA-256 (first 16) |
|---|---|---|---|
| `OSH_11052026.pdf` | **Occupational Safety, Health and Working Conditions Code, 2020** (No. 37 of 2020) | 531,293 | `9ce8f68b88f725fb` |
| `CentralRule_12052026.pdf` | **OSH (Central) Rules, 2026**, G.S.R. 345(E), 8 May 2026. English text from Gazette page 139 | 2,008,390 | `4a18cf54880519e5` |
| `Coal_Mines_Regulation_2017_Noti.pdf` | **Coal Mines Regulations, 2017**, G.S.R. 1449(E), 27 Nov 2017. English text from Gazette page 160 | 4,360,642 | `e7702993d2d00db5` |

Base URL: `https://www.dgms.gov.in/writereaddata/UploadFile/`

## Downloaded, not yet used: scanned images

| File | What it is | Size | SHA-256 (first 16) |
|---|---|---|---|
| `DGMScircularsfrom20182024_06122024.pdf` | DGMS circulars 2018–2024. 135 of 155 pages are scans | 24,790,894 | `00b2783e7fc62786` |
| `DGMS_Circulars-2015.pdf` | DGMS circulars 2015. All 24 pages are scans | 2,101,254 | `174b985cd0e9d94d` |
| `dgmscircular3_27082024.pdf` | DGMS Circular 3 of 2024, safety in opencast coal mines. Scanned | 706,433 | `9e40fd07791b2965` |
| `STATUTORYFRAMEWORK.pdf` | DGMS overview of the statutory framework | 204,155 | `930fdb054d7a784a` |

These need OCR before they can be used. Until then they contribute nothing.

## Superseded: reference only, never training data

| File | Status | Size | SHA-256 (first 16) |
|---|---|---|---|
| `superseded/MinesAct1952.pdf` | **Repealed** by OSH Code 2020, s.143(1)(c) | 153,299 | `af34ab016112fa7a` |
| `superseded/Mines_Rules_1955.pdf` | **Superseded** by OSH (Central) Rules 2026 (Gazette p.139) | 154,356 | `5c5692bb4285b2cf` |

Kept only to map an old citation to its replacement.

## What is in force, and how that was established

Read from the documents themselves, not from a summary:

- **OSH Code 2020, s.143(1)(c)** repeals the Mines Act, 1952. The Code has been in force since 21 November 2025.
- **OSH Code 2020, s.143(3)** keeps anything made under a repealed Act, including rules and regulations, in force "to the extent they are not contrary to the provisions of this Code till they are repealed by the Central Government".
- **OSH (Central) Rules 2026, preamble (Gazette p.139)** supersedes, among others, the Mines Rules 1955, the Mines Rescue Rules 1985, the Mines Vocational Training Rules 1966, the Pithead Bath Rules 1959 and the Mines Crèche Rules 1966.
- The **Coal Mines Regulations 2017** are not in that list, so they remain in force under s.143(3).

**The app's own clause corpus** (`api/seed/clauses.json`) still cites the Mines Act 1952 and the Mines Rules 1955 as current. That predates this finding and needs mapping to the OSH Code and OSH (Central) Rules 2026 provisions that replaced them. It is not changed by the dataset work.

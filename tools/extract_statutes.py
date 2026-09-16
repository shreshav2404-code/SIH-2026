"""Turn the current statutory texts into cited provisions and definitions.

    .venv-train/Scripts/python tools/extract_statutes.py

Reads the text pulled from the official PDFs in data/sources (see
data/sources/SOURCES.md) and writes data/statutes.jsonl: one record per
regulation, rule or section, and one per defined term, each carrying the exact
reference it came from.

WHICH LAW, AND WHY. Checked against the documents themselves on 2026-09-16:

  - Mines Act, 1952: REPEALED by the Occupational Safety, Health and Working
    Conditions Code, 2020, section 143(1)(c), in force since 21 Nov 2025.
  - Mines Rules, 1955: SUPERSEDED by the OSH (Central) Rules, 2026, notified
    8 May 2026 (G.S.R. 345(E), page 139 of the Gazette).
  - Coal Mines Regulations, 2017: STILL IN FORCE, saved by OSH Code s.143(3)
    "to the extent they are not contrary to the provisions of this Code".

So the sources here are the OSH Code 2020, the OSH (Central) Rules 2026 and
CMR 2017. The repealed texts sit in data/sources/superseded only to map old
citations to new ones; training a model on them as current law would teach it
law that no longer applies.

WHAT THE PDFs DO TO THE TEXT, and what is done about it:

  - The Gazette prints Hindi and English. The Hindi uses a legacy font that
    pypdf decodes as Latin letters ("Hkkx II µ[k.M"), so whole pages look like
    English to a naive filter. Pages are kept only if enough of their words
    are common English function words.
  - Words arrive split by stray spaces: "a ny", "ha s", "resp onsible",
    "m onths". A split is repaired ONLY when the joined word occurs whole
    elsewhere in the same document, so no word is ever guessed.
  - Running headers ("THE GAZETTE OF INDIA : EXTRAORDINARY ...") are removed.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT = ROOT / "data" / "text"
OUT = ROOT / "data" / "statutes.jsonl"

COMMON = set(
    "the of and to in a be shall or any for by as with such is which that not "
    "mine manager person every where at from on this under".split()
)
HEADER = re.compile(
    r"^.*(THE GAZETTE OF INDIA|GAZETTE OF INDIA|\[P\s*ART\s*II|भारत का|रािपत्र|Hkkjr dk).*$",
    re.MULTILINE,
)


def english_pages(path: Path, min_ratio: float = 0.12) -> list[str]:
    pages = path.read_text(encoding="utf-8").split("\n\f\n")
    keep = []
    for p in pages:
        words = re.findall(r"[A-Za-z]{2,}", p)
        if words and sum(w.lower() in COMMON for w in words) / len(words) > min_ratio:
            keep.append(p)
    return keep


def repair_splits(text: str) -> str:
    """Join "resp onsible" -> "responsible" when "responsible" occurs whole.

    Walks every adjacent word pair. A regex substitution does not: its matches
    cannot overlap, so in "mining opera tion" it tests "mining opera", consumes
    "opera", and never looks at "opera tion" at all - which is how the first
    version left hundreds of splits in place.
    """
    vocab = Counter(w.lower() for w in re.findall(r"[A-Za-z]+", text))
    parts = re.split(r"([A-Za-z]+)", text)  # words at odd indexes

    def joinable(a: str, b: str) -> bool:
        if not b[:1].islower():
            return False
        whole = (a + b).lower()
        # Once is enough: the joined word still has to exist, spelled whole,
        # somewhere in this same document. Requiring two left "introd ucing"
        # split because "introducing" appears whole only once.
        if vocab.get(whole, 0) < 1:
            return False
        # Two real words side by side ("in to", "at all") stay apart unless
        # the join is far commoner than either half.
        if vocab.get(a.lower(), 0) >= 20 and vocab.get(b.lower(), 0) >= 20:
            return vocab[whole] >= 5 * min(vocab[a.lower()], vocab[b.lower()])
        return True

    i = 1
    while i + 2 < len(parts):
        if parts[i + 1] == " " and joinable(parts[i], parts[i + 2]):
            parts[i] = parts[i] + parts[i + 2]
            del parts[i + 1 : i + 3]
            continue  # the joined word may join again: "resp on sible"
        i += 2
    text = "".join(parts)
    text = re.sub(r"\b(sub) -(rule|regulation|section)", r"\1-\2", text)
    return text


def clean(pages: list[str]) -> str:
    text = "\n".join(pages)
    text = HEADER.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = repair_splits(text)
    return text


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def provisions(text: str, pattern: re.Pattern, source: str, ref_fmt: str, limit: int) -> list[dict]:
    """Split on numbered headings, keeping only a strictly increasing sequence.

    Numbers also appear inside provisions ("3. The manager..." in a proviso,
    form numbers, dates). Requiring each accepted heading to be the next
    number, or close after it, discards those without a list of exceptions.
    """
    found = []
    last = 0
    for m in pattern.finditer(text):
        n = int(m.group(1))
        if last < n <= last + 3 and n <= limit:
            found.append((m.start(), m.end(), n, squash(m.group(2))))
            last = n
    out = []
    chapter = None
    chapters = [(m.start(), squash(m.group(1))) for m in re.finditer(
        r"CHAPTER\s+[IVXL]+[A-Z]?\s*\n\s*([A-Z][A-Z ,&'()\-]{3,80})\n", text)]
    for i, (start, body_start, n, heading) in enumerate(found):
        end = found[i + 1][0] if i + 1 < len(found) else len(text)
        for pos, title in chapters:
            if pos < start:
                chapter = title.title()
        body = squash(text[body_start:end])
        if len(body) < 40:
            continue
        out.append({
            "kind": "provision",
            "source": source,
            "ref": ref_fmt.format(n=n),
            "number": n,
            "heading": heading.rstrip(".").strip(),
            "chapter": chapter,
            "text": body[:4000],
        })
    return out


def definitions(text: str, source: str, ref_fmt: str) -> list[dict]:
    out = []
    seen = set()
    for m in re.finditer(
        r"\((\w{1,3})\)\s+[“\"]([^”\"]{2,80})[”\"]\s+((?:means|includes|shall have)[^;]{10,900});",
        text,
    ):
        term = squash(m.group(2))
        if term.lower() in seen:
            continue
        seen.add(term.lower())
        out.append({
            "kind": "definition",
            "source": source,
            "ref": ref_fmt.format(clause=m.group(1)),
            "term": term,
            "text": squash(f'"{term}" {m.group(3)}'),
        })
    return out


def main() -> None:
    records: list[dict] = []

    # ---- Coal Mines Regulations, 2017 (G.S.R. 1449(E), 27 Nov 2017)
    cmr = clean(english_pages(TEXT / "Coal_Mines_Regulation_2017_Noti.txt"))
    cmr = cmr[cmr.find("1. Short title") if "1. Short title" in cmr else 0:]
    reg = re.compile(r"(?m)^\s*(\d{1,3})\.\s+([A-Z][^.\n—–]{2,110}?)\.\s*[—–-]+\s*")
    cmr_prov = provisions(cmr, reg, "Coal Mines Regulations, 2017", "CMR 2017 · Reg. {n}", 250)
    cmr_defs = definitions(cmr[: cmr.find("CHAPTER II")] if "CHAPTER II" in cmr else cmr[:60000],
                           "Coal Mines Regulations, 2017", "CMR 2017 · Reg. 2({clause})")
    records += cmr_prov + cmr_defs

    # ---- OSH (Central) Rules, 2026 (G.S.R. 345(E), 8 May 2026) - English half
    cr = clean(english_pages(TEXT / "CentralRule_12052026.txt"))
    cr = cr[cr.find("CHAPTER - I") if "CHAPTER - I" in cr else 0:]
    rule = re.compile(r"(?m)^\s*(\d{1,3})\.\s+([A-Z][^.\n]{2,110}?)\.\s*-\s*")
    records += provisions(cr, rule, "OSH (Central) Rules, 2026", "OSH Central Rules 2026 · R. {n}", 200)

    # ---- OSH Code, 2020 - sections carry marginal headings the PDF moves to
    # the end of the page, so sections are kept by number and text only.
    osh = clean(english_pages(TEXT / "OSH_11052026.txt", 0.10))
    sec = re.compile(r"(?m)^\s*(\d{1,3})\.\s+(\(1\)[^\n]{0,0}|[A-Z][^\n]{0,0})")
    found = []
    last = 0
    for m in re.finditer(r"(?m)^\s*(\d{1,3})\.\s+(?=\(1\)|[A-Z])", osh):
        n = int(m.group(1))
        if last < n <= last + 3 and n <= 143:
            found.append((m.start(), m.end(), n))
            last = n
    for i, (s, e, n) in enumerate(found):
        end = found[i + 1][0] if i + 1 < len(found) else len(osh)
        body = squash(osh[e:end])
        if len(body) >= 60:
            records.append({
                "kind": "provision", "source": "OSH Code, 2020",
                "ref": f"OSH Code 2020 · S.{n}", "number": n, "heading": None,
                "chapter": None, "text": body[:4000],
            })
    records += definitions(osh[:40000], "OSH Code, 2020", "OSH Code 2020 · S.2(1)({clause})")

    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8")
    kinds = Counter((r["source"], r["kind"]) for r in records)
    for (src, kind), n in sorted(kinds.items()):
        print(f"  {src:<32} {kind:<11} {n}")
    print(f"  -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

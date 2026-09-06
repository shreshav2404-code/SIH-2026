"""Circular chunking, which decides whether the right clause is retrieved.

This exists because of a measured failure. A three-sentence DGMS circular about
methane in the general body of return air retrieved "CPCB - CAAQMS uptime"
(ambient air quality stations) at 0.442, ahead of the correct CMR 2017 Reg. 46
at 0.432. Nothing was broken in the embedding or the corpus - all 52 clauses
were embedded and short queries scored well (0.871 for "dump slope"). The
chunker split the text into sentences and then greedily RE-PACKED them up to
480 chars, so a short circular collapsed back into one chunk and one averaged
vector, pulled toward the generic "air monitoring" language both clauses share.

One sentence, one chunk fixed it: Reg. 46 rose to 0.501 and won.

These tests pin the shape of the split rather than the retrieval scores, which
depend on the model and the corpus. If someone reintroduces packing to "reduce
embedding calls", test_sentences_are_not_repacked fails loudly.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.embeddings import chunk  # noqa: E402

CIRCULAR = (
    "DGMS (Tech) Circular No. 05 of 2026. In every belowground coal mine the "
    "Ventilation Officer shall measure methane in the general body of the "
    "return air of each district at least once in every seven days and record "
    "the result in the ventilation register."
)


def test_sentences_are_not_repacked():
    """The regression. Two sentences must not become one chunk.

    Packing them averages two topics into one vector, which is exactly how a
    methane circular came to retrieve an ambient-air-station clause.
    """
    chunks = chunk(CIRCULAR)
    assert len(chunks) >= 2, f"sentences were re-packed: {chunks}"
    # The substantive sentence must survive intact, not be split mid-duty.
    body = [c for c in chunks if "Ventilation Officer" in c]
    assert len(body) == 1
    assert "seven days" in body[0]


def test_one_chunk_per_duty():
    """Two duties in one paste produce two chunks, so both are retrievable."""
    chunks = chunk(
        "The manager shall inspect the overburden dump slope each week. "
        "The Safety Officer shall maintain the overtime register."
    )
    assert len(chunks) == 2
    assert any("dump slope" in c for c in chunks)
    assert any("overtime register" in c for c in chunks)


def test_header_line_stands_alone():
    """A circular's header must not be glued to the duty that follows.

    "DGMS (Tech) Circular No. 05 of 2026." is short, but merging it forward
    reintroduces the averaging. It becomes its own chunk, retrieves nothing
    useful, and loses on similarity to the chunk that matters.
    """
    chunks = chunk(CIRCULAR)
    assert chunks[0].startswith("DGMS")
    assert "Ventilation Officer" not in chunks[0]


def test_true_fragments_are_merged_not_embedded():
    """"Provided that." on its own is noise, and is attached to a neighbour."""
    chunks = chunk("The manager shall inspect the working places every day. Provided that.")
    assert len(chunks) == 1
    assert chunks[0].endswith("Provided that.")


def test_long_sentence_is_capped():
    long_one = "The manager shall " + ("record every reading " * 60) + "in the register."
    chunks = chunk(long_one, max_chars=480)
    assert all(len(c) <= 480 for c in chunks)


def test_empty_and_whitespace():
    assert chunk("") == []
    assert chunk("    \n\t  ") == []


def test_single_short_sentence_survives():
    """A one-line query must still produce a chunk, not be swallowed."""
    assert chunk("methane in the return airway") == ["methane in the return airway"]

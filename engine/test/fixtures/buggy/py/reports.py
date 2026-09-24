"""Fixture: intentionally buggy. Review input for the engine's own tests."""


def collect_totals(rows, totals=[]):
    for row in rows:
        totals.append(row["amount"])
    return totals

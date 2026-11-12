Captured engine views that tests assert specific content against (a seat's
faction, a hero's name, a score). Unlike `../ngg/`, which
`scripts/ngg-fixtures.mjs` regenerates from the current engine, these are
kept as they are, so a change in how seeded AI games unfold does not move
them. Regenerate one only when the view's shape changes.

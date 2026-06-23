Feature: Comment anchoring (Phase 2 — inline collaboration)
  As a reviewer commenting on a diff
  I want comments pinned to a line by content (hash), not just line number
  So that my comment stays on the right line after the agent edits the file
  and a new diff arrives — and is never silently lost.

  Scenario: Anchoring captures the target line's content hash
    Given a diff whose new side has "const foo = 1;" at line 3
    When I anchor a comment to the new side at line 3
    Then the anchor records line 3
    And the anchor lineTextHash equals the hash of "const foo = 1;"
    And the anchor is not orphaned

  Scenario: Re-anchoring moves a comment when its line shifts down
    Given an anchor on new-side "target line" at line 3
    When a new diff places "target line" at line 7
    Then re-anchoring moves the comment to line 7
    And the comment is not orphaned

  Scenario: Re-anchoring orphans a comment when its line is deleted
    Given an anchor on new-side "gone line" at line 3
    When a new diff no longer contains "gone line"
    Then re-anchoring marks the comment orphaned
    And the comment is still in the list (never dropped)

  Scenario: Identical lines resolve to the nearest line by number
    Given an anchor on new-side "dup" at line 5
    When a new diff has "dup" at both line 2 and line 6
    Then re-anchoring moves the comment to line 6 (nearest to 5)

  Scenario: commentsForLine filters by path, side and line
    Given anchors on "a.ts" new line 3, "a.ts" old line 3, and "b.ts" new line 3
    When I query comments for "a.ts" new line 3
    Then exactly one comment is returned

  Scenario: An empty anchor list returns nothing
    Given no anchors
    When I query comments for any line
    Then the result is empty

  Scenario: The resolved flag round-trips through re-anchoring
    Given a resolved anchor on new-side "kept" at line 3
    When the line does not move
    Then re-anchoring preserves the resolved flag

  Scenario: Re-anchoring is idempotent when nothing moved
    Given an anchor on a line that stays put
    When re-anchoring runs twice
    Then the anchor line number is unchanged both times

  Scenario: Review-code self-review produces review.update events the panel folds
    Given the agent self-reviews a diff and emits review.update for "a.ts" line 10
    When the panel state folds the event
    Then the review pane has one comment on "a.ts" line 10

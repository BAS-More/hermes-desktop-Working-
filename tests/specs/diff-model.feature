Feature: Unified-diff model (Phase 1 — diff cockpit data layer)
  As the diff cockpit
  I want a pure parser that turns a unified diff into typed file/hunk/line
  structures and a side-by-side row model
  So that the file list, +N -M badge, and side-by-side viewer are all pure
  consumers of one diff model with no parsing logic of their own.

  Scenario: Parse a two-file patch and count additions and removals
    Given a unified diff touching "src/a.ts" (+3 -1) and "src/b.ts" (+0 -2)
    When the patch is parsed
    Then there are 2 file diffs
    And file "src/a.ts" reports 3 added and 1 removed
    And file "src/b.ts" reports 0 added and 2 removed

  Scenario: A new file is detected from the /dev/null old path
    Given a unified diff that adds a brand new file "src/new.ts"
    When the patch is parsed
    Then file "src/new.ts" is marked as a new file
    And its removed count is 0

  Scenario: A deleted file is detected from the /dev/null new path
    Given a unified diff that deletes "src/old.ts"
    When the patch is parsed
    Then file "src/old.ts" is marked as deleted
    And its added count is 0

  Scenario: A rename keeps both old and new paths
    Given a unified diff that renames "src/old.ts" to "src/new.ts"
    When the patch is parsed
    Then the file diff path is "src/new.ts"
    And the file diff oldPath is "src/old.ts"

  Scenario: A hunk header assigns correct old and new line numbers
    Given a hunk header "@@ -10,3 +10,4 @@"
    When the hunk lines are parsed
    Then the first context line has oldLineNo 10 and newLineNo 10
    And an added line has a newLineNo but no oldLineNo
    And a deleted line has an oldLineNo but no newLineNo

  Scenario: Side-by-side pairs a deletion and an addition as one change row
    Given a hunk with one deleted line then one added line
    When converted to side-by-side rows
    Then there is one row with a left deletion and a right addition

  Scenario: Side-by-side puts a context line on both sides
    Given a hunk with a single context line
    When converted to side-by-side rows
    Then that row has the same text on the left and the right

  Scenario: Unequal deletions and additions still align without dropping lines
    Given a hunk with 3 deleted lines then 1 added line
    When converted to side-by-side rows
    Then no line text is lost
    And every deleted line appears on the left
    And the single added line appears on the right

  Scenario: A malformed or empty patch parses to an empty list without throwing
    Given an empty string patch
    When the patch is parsed
    Then the result is an empty list

  Scenario: CRLF line endings and "no newline" markers are handled
    Given a unified diff with CRLF endings and a "\ No newline at end of file" marker
    When the patch is parsed
    Then the line counts ignore the no-newline marker
    And no carriage-return characters remain in the line text

  Scenario: The badge totals additions and removals across all files
    Given a parsed patch with files (+3 -1) and (+0 -2)
    When the total badge is computed
    Then the badge is "+3 -3"

Feature: Preview model (Phase 4 — preview stack data layer)
  As the preview pane
  I want pure helpers for per-project storage isolation, target classification,
  and the agent's auto-verify result state
  So that previews don't leak cookies across projects and the verify loop's
  outcome is rendered from one reduced state.

  # --- per-project cookie/storage partition ---
  Scenario: The same project and persist flag yield the same partition
    Given project path "/home/me/proj-a"
    When I compute the persistent partition twice
    Then both partition names are identical

  Scenario: Persistent and ephemeral partitions differ by a persist prefix
    Given project path "/home/me/proj-a"
    Then the persistent partition starts with "persist:"
    And the ephemeral partition does not start with "persist:"
    And they share the same trailing hash

  Scenario: Different projects get different partitions
    Given project paths "/home/me/proj-a" and "/home/me/proj-b"
    Then their ephemeral partitions are different

  Scenario: An empty project path still yields a stable, non-empty partition
    Given an empty project path
    Then the partition is non-empty and deterministic

  # --- target classification ---
  Scenario Outline: Classify a preview target by url or extension
    Given a preview target "<target>"
    Then it classifies as "<kind>"

    Examples:
      | target                  | kind    |
      | https://localhost:3000  | web     |
      | http://127.0.0.1:8080   | web     |
      | report.pdf              | pdf     |
      | index.html              | html    |
      | photo.PNG               | image   |
      | clip.mp4                | video   |
      | data.bin                | unknown |
      |                         | unknown |

  # --- auto-verify result reducer ---
  Scenario: verify.start moves the state to running and clears checks
    Given a passed preview state
    When a verify.start event is applied
    Then the status is "running"
    And there are no checks

  Scenario: verify.check appends a check
    Given a running preview state
    When a passing screenshot check is applied
    Then there is one check recorded

  Scenario: a failed check makes the overall verify fail
    Given a running preview state
    When a failing dom check is applied
    Then the status is "failed"

  Scenario: verify.done with all checks ok marks the state passed
    Given a running preview state with two passing checks
    When verify.done is applied
    Then the status is "passed"

  Scenario: verify.done after a failed check stays failed
    Given a running preview state with one failing check
    When verify.done is applied
    Then the status is "failed"

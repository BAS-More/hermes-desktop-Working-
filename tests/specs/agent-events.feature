Feature: Agent → UI event contract (Phase 0 foundation)
  As the Hermes desktop UI
  I want a single typed stream of agent events folded by a pure reducer
  So that every right-side-panel pane (todo, tasks, plan, diff, review, usage)
  is a pure consumer of one AgentPanelState and never invents its own pipeline.

  Background:
    Given an empty AgentPanelState

  # --- Always-visible to-do list: the headline requirement ---
  Scenario: A todo.update populates the always-visible checklist
    When the agent emits "todo.update" with items:
      | id | content        | status      |
      | t1 | Recon repo     | completed   |
      | t2 | Write schema   | in_progress |
      | t3 | Run tests      | pending     |
    Then the panel todo list has 3 items
    And todo item "t1" is "completed"
    And todo item "t2" is "in_progress"

  Scenario: A todo item flips to completed and the checkbox ticks
    Given a "todo.update" with item "t2" status "in_progress"
    When the agent emits "todo.update" with item "t2" status "completed"
    Then todo item "t2" is "completed"
    And the completed todo count is 1

  Scenario: todo.update replaces the list wholesale (snapshot semantics, not merge)
    Given a "todo.update" with items "a,b,c" all "pending"
    When the agent emits "todo.update" with items "a,b" all "pending"
    Then the panel todo list has 2 items
    And there is no todo item "c"

  # --- Usage ring: context% + plan% ---
  Scenario: A usage.update refreshes context and plan usage
    When the agent emits "usage.update" with contextPct 42 and planPct 17
    Then the panel usage contextPct is 42
    And the panel usage planPct is 17

  Scenario: A stale usage.update with an older sequence is ignored
    Given a "usage.update" with seq 5 and contextPct 80
    When the agent emits "usage.update" with seq 3 and contextPct 10
    Then the panel usage contextPct is 80

  # --- Diff badge: +N -M ---
  Scenario: A diff.update records additions and deletions per file
    When the agent emits "diff.update" for file "src/app.ts" with 12 added and 1 removed
    Then the panel diff for "src/app.ts" shows 12 added and 1 removed
    And the panel total diff badge is "+12 -1"

  # --- Plan + tasks + review panes (consumers of same stream) ---
  Scenario: A plan.update sets the current plan steps
    When the agent emits "plan.update" with steps "Explore,Implement,Verify"
    Then the panel plan has 3 steps

  Scenario: A review.update appends an inline review comment to a file line
    When the agent emits "review.update" for file "src/app.ts" line 10 with comment "off-by-one"
    Then the panel review for "src/app.ts" has 1 comment on line 10

  # --- Forward-compat + robustness (failure modes) ---
  Scenario: An unknown event type is ignored without throwing
    When the agent emits "future.unknown.event" with arbitrary payload
    Then the AgentPanelState is unchanged

  Scenario: A malformed payload does not corrupt existing state
    Given a "usage.update" with contextPct 50 and planPct 25
    When the agent emits "todo.update" with a non-array items payload
    Then the panel usage contextPct is 50
    And the panel todo list has 0 items

  Scenario: Duplicate identical events are idempotent
    Given a "todo.update" with item "t1" status "completed"
    When the agent emits the same "todo.update" again
    Then the panel todo list has 1 item
    And the completed todo count is 1
